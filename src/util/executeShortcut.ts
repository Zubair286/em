import { GestureResponderEvent } from 'react-native'
import { Store } from 'redux'
import MulticursorFilter from '../@types/MulticursorFilter'
import Path from '../@types/Path'
import Shortcut from '../@types/Shortcut'
import ShortcutType from '../@types/ShortcutType'
import State from '../@types/State'
import ThoughtId from '../@types/ThoughtId'
import { addMulticursorActionCreator as addMulticursor } from '../actions/addMulticursor'
import { alertActionCreator as alert } from '../actions/alert'
import { setCursorActionCreator as setCursor } from '../actions/setCursor'
import { AlertType, HOME_PATH, noop } from '../constants'
import * as selection from '../device/selection'
import documentSort from '../selectors/documentSort'
import hasMulticursor from '../selectors/hasMulticursor'
import thoughtToPath from '../selectors/thoughtToPath'
import globalStore from '../stores/app'
import equalPath from './equalPath'
import hashPath from './hashPath'
import head from './head'
import parentOf from './parentOf'
import UnreachableError from './unreachable'

interface Options {
  store?: Store<State, any>
  type?: ShortcutType
  event?: Event | GestureResponderEvent | KeyboardEvent | React.MouseEvent | React.TouchEvent
}

const eventNoop = { preventDefault: noop } as Event

/** Filter the cursors based on the filter type. Cursors are sorted in document order. */
const filterCursors = (_state: State, cursors: Path[], filter: MulticursorFilter = 'all') => {
  switch (filter) {
    case 'all':
      return cursors

    case 'first-sibling': {
      const seenParents = new Set<string>()

      return cursors.filter(cursor => {
        const parent = hashPath(parentOf(cursor))

        if (seenParents.has(parent)) return false
        seenParents.add(parent)

        return true
      })
    }

    case 'last-sibling': {
      const seenParents = new Set<string>()

      return cursors.reverse().filter(cursor => {
        const parent = hashPath(parentOf(cursor))

        if (seenParents.has(parent)) return false
        seenParents.add(parent)

        return true
      })
    }

    case 'prefer-ancestor': {
      const seenCursors = new Set<string>()

      return cursors.filter(cursor => {
        const parent = hashPath(parentOf(cursor))

        // Always add the cursor to the set to resolve direct chains.
        seenCursors.add(hashPath(cursor))

        return !seenCursors.has(parent)
      })
    }

    default:
      // Make sure all cases are covered
      throw new UnreachableError(filter)
  }
}

/** Recomputes the path to a thought. Returns null if the thought does not exist. */
const recomputePath = (state: State, thoughtId: ThoughtId) => {
  const path = thoughtToPath(state, thoughtId)

  if (path && equalPath(path, HOME_PATH)) return null

  return path
}

/** Execute a single shortcut. Defaults to global store and keyboard shortcut. Use `executeShortcutWithMulticursor` to execute a shortcut with multicursor mode. */
const executeShortcut = (shortcut: Shortcut, { store, type, event }: Options = {}) => {
  store = store ?? globalStore
  type = type ?? 'keyboard'
  event = event ?? eventNoop

  const canExecute = !shortcut.canExecute || shortcut.canExecute(store.getState())
  // Exit early if the shortcut cannot execute
  if (!canExecute) return

  // execute single shortcut
  shortcut.exec(store.dispatch, store.getState, event, { type })
}

/** Execute shortcut. Defaults to global store and keyboard shortcut. */
export const executeShortcutWithMulticursor = (shortcut: Shortcut, { store, type, event }: Options = {}) => {
  store = store ?? globalStore
  type = type ?? 'keyboard'
  event = event ?? eventNoop

  const state = store.getState()

  const shouldExecuteMulticursor = hasMulticursor(state) && shortcut.multicursor !== 'ignore'

  // If we don't have active multicursors or the shortcut ignores multicursors, execute the shortcut normally.
  if (!shouldExecuteMulticursor) return executeShortcut(shortcut, { store, type, event })

  const multicursorConfig =
    typeof shortcut.multicursor === 'object'
      ? shortcut.multicursor
      : shortcut.multicursor
        ? { enabled: true }
        : { enabled: false }

  // multicursor is not enabled for this shortcut, alert and exit early
  if (!multicursorConfig.enabled) {
    const errorMessage = !multicursorConfig.error
      ? 'Cannot execute this shortcut with multiple thoughts.'
      : typeof multicursorConfig.error === 'string'
        ? () => multicursorConfig.error as string
        : multicursorConfig.error(store.getState())
    store.dispatch(
      alert(errorMessage, {
        alertType: AlertType.MulticursorError,
        clearDelay: 5000,
      }),
    )
    return
  }

  // Save the cursor before execution
  const cursorBeforeExecution = state.cursor

  // For each multicursor, place the cursor on the path and execute the shortcut by calling executeShortcut.
  const paths = documentSort(state, Object.values(state.multicursors))

  const filteredPaths = filterCursors(state, paths, multicursorConfig.filter)

  const canExecute = filteredPaths.every(
    path => !shortcut.canExecute || shortcut.canExecute({ ...state, cursor: path }),
  )

  // Exit early if the shortcut cannot execute
  if (!canExecute) return

  // Reverse the order of the cursors if the shortcut has reverse multicursor mode enabled.
  if (multicursorConfig.reverse) {
    filteredPaths.reverse()
  }

  /** Multicursor execution loop. */
  const execMulticursor = () => {
    // Execute the shortcut for each multicursor path and restore the cursor to its original position.
    for (const path of filteredPaths) {
      // Make sure we have the correct path to the thought in case it was moved during execution.
      const recomputedPath = recomputePath(store.getState(), head(path))
      if (!recomputedPath) continue

      store.dispatch(setCursor({ path: recomputedPath }))
      executeShortcut(shortcut, { store, type, event })
    }
  }

  if (multicursorConfig.execMulticursor) {
    // The shortcut has their own multicursor logic, so delegate to it and pass in the default execMulticursor function.
    multicursorConfig.execMulticursor(filteredPaths, store.dispatch, store.getState, event, { type }, execMulticursor)
  } else {
    execMulticursor()
  }

  // Restore the cursor to its original position if not prevented.
  if (!multicursorConfig.preventSetCursor && cursorBeforeExecution) {
    store.dispatch(setCursor({ path: recomputePath(store.getState(), head(cursorBeforeExecution)) }))
    requestAnimationFrame(() => {
      selection.clear()
    })
  }

  if (!multicursorConfig.clearMulticursor) {
    // Restore multicursors
    store.dispatch(
      paths.map(path => (dispatch, getState) => {
        const recomputedPath = recomputePath(getState(), head(path))
        if (!recomputedPath) return
        dispatch(addMulticursor({ path: recomputedPath, ignoreCursor: true }))
      }),
    )
  }
}

export default executeShortcut
