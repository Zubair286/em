import * as db from '../db'
import { importText } from '../action-creators'
import { EM_TOKEN, INITIAL_SETTINGS, ROOT_TOKEN } from '../constants'
import { decodeThoughtsUrl, expandThoughts, getThoughts } from '../selectors'
import { isRoot, logWithTime } from '../util'

/** Loads thoughts from the IndexedDB database. */
const loadLocalThoughts = () => async (dispatch, getState) => {

  // TODO: Fix IndexedDB during tests
  const test = process.env.NODE_ENV === 'test'

  const { cursor } = test ? {} : await db.getHelpers()
  logWithTime('loadLocalThoughts: getHelpers')

  // load the EM tree
  const thoughtsEm = test ? {} : await db.getDescendantThoughts([EM_TOKEN])
  logWithTime('loadLocalThoughts: thoughtsEm loaded from IndexedDB')

  // load the root tree
  const thoughtsRoot = test ? {} : await db.getDescendantThoughts([ROOT_TOKEN])
  logWithTime('loadLocalThoughts: thoughtsRoot loaded from IndexedDB')

  const thoughts = {
    contextIndex: test ? {} : {
      ...thoughtsEm.contextIndex,
      ...thoughtsRoot.contextIndex,
    },
    thoughtIndex: test ? {} : {
      ...thoughtsEm.thoughtIndex,
      ...thoughtsRoot.thoughtIndex,
    },
  }

  const restoreCursor = window.location.pathname.length <= 1 && cursor
  const { thoughtsRanked, contextViews } = decodeThoughtsUrl({ thoughts }, restoreCursor ? cursor : window.location.pathname)
  const cursorNew = isRoot(thoughtsRanked) ? null : thoughtsRanked
  const expanded = expandThoughts(
    { thoughts, contextViews },
    cursorNew || []
  )

  // instantiate initial Settings if it does not exist
  dispatch({
    type: 'loadLocalThoughts',
    contextViews,
    cursor: cursorNew,
    cursorBeforeEdit: cursorNew,
    expanded,
    thoughts,
  })

  logWithTime('loadLocalThoughts: action dispatched')

  if (getThoughts({ thoughts }, [EM_TOKEN, 'Settings']).length === 0) {
    await dispatch(importText([{ value: EM_TOKEN, rank: 0 }], INITIAL_SETTINGS))
  }
}

export default loadLocalThoughts
