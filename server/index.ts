import { Server } from '@hocuspocus/server'
import fs from 'fs'
import level from 'level'
import path from 'path'
import { LeveldbPersistence } from 'y-leveldb'
import * as Y from 'yjs'
import DocLogAction from '../src/@types/DocLogAction'
import Share from '../src/@types/Share'
import ThoughtId from '../src/@types/ThoughtId'
import {
  encodeDocLogDocumentName,
  encodeLexemeDocumentName,
  encodePermissionsDocumentName,
  encodeThoughtDocumentName,
  parseDocumentName,
} from '../src/data-providers/yjs/documentNameEncoder'
import replicationController from '../src/data-providers/yjs/replicationController'
import timestamp from '../src/util/timestamp'

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error'

const port = process.env.PORT ? +process.env.PORT : 3001
// must match the db directory used in backup.sh and the clear npm script
const dbDir = process.env.DB_DIR || 'db'
const thoughtsDbBasePath = `${dbDir}/thoughts`
const doclogDbBasePath = `${dbDir}/doclogs`
const replicationCursorDbBasePath = `${dbDir}/replicationCursor`

// contains a top level map for each thoughtspace Map<Share> mapping token -> permission
const permissionsServerDoc = new Y.Doc()

/** Shows the first n characters of a string and replaces the rest with an ellipsis. */
const mask = (s: string, n = 4) => `${s.slice(0, n)}...`

/** Gets a permissionsServerDoc by name that is synced by the server. */
const getYDoc = (name: string): Y.Doc | undefined => server.documents.get(name)

/** Make text gray in the console. */
const gray = (s: string) => `\x1B[90m${s}\x1b[0m`

/** Logs a message to the console with an ISO timestamp. Optionally takes a console method for its last argument. Defaults to info. */
const log = (...args: [...any, ...([ConsoleMethod] | [])]) => {
  // prepend timestamp
  args = [gray(new Date().toISOString()), ...args]

  // default to console.info
  // override the method by passing { method: 'error' } as the last argument
  let method: ConsoleMethod = 'info'
  const lastArg = args[args.length - 1]
  if (typeof lastArg === 'object' && Object.keys(lastArg).length === 1 && lastArg.method) {
    args = args.slice(0, -1)
    method = lastArg.method
  }

  // eslint-disable-next-line no-console
  console[method](...args)
}

// setup db data directory
// TODO: How to create data/thoughtspaces/${tsid}/ and then persist into thoughts/ or doclogs/? That would be a nicer file structure, but it causes "directory does not exist" or lock errors.
fs.mkdirSync(thoughtsDbBasePath, { recursive: true })
fs.mkdirSync(doclogDbBasePath, { recursive: true })
fs.mkdirSync(replicationCursorDbBasePath, { recursive: true })

const ldbPermissions = new LeveldbPersistence(`${dbDir}/permissions`)
// indexed by tsid
// set on loadDocument (idempotent)
// deleted when doclog disconnects
const ldbThoughtspaces = new Map<string, LeveldbPersistence>()
const ldbDoclogs = new Map<string, LeveldbPersistence>()
const ldbReplicationCursors = new Map<string, level.LevelDB>()

/** Syncs a doc with leveldb and subscribes to updates. */
const bindState = async ({ db, docName, doc }: { db: LeveldbPersistence; docName: string; doc: Y.Doc }) => {
  const docPersisted = await db.getYDoc(docName)
  const updates = Y.encodeStateAsUpdate(doc)
  await db.storeUpdate(docName, updates)
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(docPersisted))
  doc.on('update', update => {
    db.storeUpdate(docName, update)
  })
}

/** Authenticates a document request with the given access token. Handles Docs for Thoughts, Lexemes, and Permissions. Assigns the token as owner if it is a new document. Throws an error if the access token is not authorized. */
export const onAuthenticate = async ({ token, documentName }: { documentName: string; token: string }) => {
  const { tsid } = parseDocumentName(documentName)
  // the server-side permissions map
  // stores the permissions for all thoughtspaces as Map<Index<Share>> (indexed by tsid and access token)
  // only accessible on the server
  const permissionsServerMap = permissionsServerDoc.getMap<Share>(tsid)

  // if the document has no owner, automatically assign the current user as owner
  if (permissionsServerMap.size === 0) {
    log(`assigning owner ${mask(token)} to new thoughtspace ${tsid}`)
    permissionsServerMap.set(token, { accessed: timestamp(), created: timestamp(), name: 'Owner', role: 'owner' })
  }

  // authenicate existing owner
  // authenticate new documents
  if (permissionsServerMap.get(token)?.role !== 'owner') {
    throw new Error('Not authorized')
  }

  // passed forward as data.context to later hooks
  return { token }
}

/** Syncs permissions to permissionsClientDoc on load. The permissionsServerDoc cannot be exposed since it contains permissions for all thoughtspaces. This must be done in onLoadDocument when permissionsClientDoc has been created through the websocket connection. */
export const onLoadDocument = async ({
  context,
  document,
  documentName,
}: {
  context: { token: string }
  document: Y.Doc
  documentName: string
}) => {
  const { token } = context
  const { tsid, type } = parseDocumentName(documentName)
  const permissionsDocName = encodePermissionsDocumentName(tsid)
  const permissionsServerMap = permissionsServerDoc.getMap<Share>(tsid)
  const permission = permissionsServerMap.get(token)

  if (!permission || permission.role !== 'owner') return

  // Copy permissions from the server-side permissions doc to the client-side permission doc.
  // The server-side permissions doc keeps all permissions for all documents in memory.
  // The client-side permissions doc uses authentication and can be exposed to the client via websocket.
  // update last accessed time on auth
  if (type === 'permissions') {
    // disable accessed in the permissionsServerMap; it does not need a CRDT
    // floor accessed to nearest second to avoid churn
    // permissionsServerMap.set(token, { ...permission, accessed: (Math.floor(timestamp() / 1000) * 1000) as Timestamp })

    const permissionsClientDoc = getYDoc(permissionsDocName)
    if (!permissionsClientDoc) return

    const permissionsClientMap = permissionsClientDoc.getMap<Share>()

    // copy server permissions to client
    permissionsServerMap.forEach((permission: Share, token: string) => {
      permissionsClientMap.set(token, permission)
    })

    // sync client permissions to server
    // TODO: Is there a way to 2-way sync only the updates for this tsid?
    permissionsClientMap?.observe(e => {
      e.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') {
          permissionsServerMap.delete(key)
        } else {
          const clientShare = permissionsClientMap.get(key)
          const serverShare = permissionsServerMap.get(key)

          // do not copy empty clientShare to server
          // (we can assume serverShare exists since onAuthenticate passed)
          if (!clientShare) return

          // compare name and role
          // do not compare created and accessed, since the server is assumed to be the source of truth
          if (clientShare?.name !== serverShare?.name || clientShare?.role !== serverShare?.role) {
            permissionsServerMap.set(key, permissionsClientMap.get(key)!)
          }
        }
      })
    })
  } else if (type === 'thought' || type === 'lexeme') {
    let db = ldbThoughtspaces.get(tsid)
    if (!db) {
      db = new LeveldbPersistence(path.join(thoughtsDbBasePath, tsid))
      ldbThoughtspaces.set(tsid, db)
    }
    await bindState({ db, docName: documentName, doc: document })
  } else if (type === 'doclog') {
    let db = ldbDoclogs.get(tsid)
    if (!db) {
      db = new LeveldbPersistence(path.join(doclogDbBasePath, tsid))
      ldbDoclogs.set(tsid, db)
    }

    // persist a replication cursor to track deletes
    let replicationCursorDb = ldbReplicationCursors.get(tsid)!
    if (!replicationCursorDb) {
      replicationCursorDb = level(path.join(replicationCursorDbBasePath, tsid), { valueEncoding: 'json' })
      ldbReplicationCursors.set(tsid, replicationCursorDb)
    }

    await bindState({ db, docName: documentName, doc: document })

    // use a replicationController to track thought and lexeme deletes in the doclog. Clears persisted documents that have been deleted
    replicationController({
      doc: document,
      next: async ({ action, id, type }) => {
        if (action === DocLogAction.Delete) {
          const name =
            type === 'thought' ? encodeThoughtDocumentName(tsid, id as ThoughtId) : encodeLexemeDocumentName(tsid, id)
          document.destroy()
          const db = ldbThoughtspaces.get(tsid)
          if (!db) {
            console.error('LeveldbPersistence instance missing', documentName)
            return
          }
          await db.clearDocument(name)
        }
      },

      // persist to level db
      storage: {
        getItem: async (key: string) => {
          let results: any = null
          try {
            results = await replicationCursorDb.get(encodeDocLogDocumentName(tsid, key))
          } catch (e) {
            // get will fail with "Key not found" the first time
            // ignore it and replication cursors will be set in next replication
          }
          return results
        },
        setItem: (key: string, value: string) => {
          replicationCursorDb.put(encodeDocLogDocumentName(tsid, key), value)
        },
      },
    })
  } else {
    console.error('Unrecognized doc type', type)
  }
}

// persist permissions to DB_PERMISSIONS with leveldb
// TODO: encrypt

console.info('Loading permissions...')
const permissionsServerSynced = bindState({ db: ldbPermissions, docName: 'permissions', doc: permissionsServerDoc })

const server = Server.configure({
  port,
  onAuthenticate,
  onListen: async () => {
    // notify pm2 that the app is ready
    process.send?.('ready')
  },
  onLoadDocument,
  onDisconnect: async ({ documentName }) => {
    // destroy the cached ldb database when the doclog disconnects
    const { tsid, type } = parseDocumentName(documentName)
    if (type === 'doclog') {
      const thoughtsDb = ldbThoughtspaces.get(tsid)
      if (thoughtsDb) {
        thoughtsDb.destroy()
        ldbThoughtspaces.delete(tsid)
      }
      const doclogDb = ldbDoclogs.get(tsid)
      if (doclogDb) {
        doclogDb.destroy()
        ldbDoclogs.delete(tsid)
      }
      const replicationCursorDb = ldbReplicationCursors.get(tsid)
      if (replicationCursorDb) {
        await replicationCursorDb.close()
        ldbReplicationCursors.delete(tsid)
      }
    }
  },
})

// gracefully exist for pm2 reload
// not that it matters... level has a lock on the db that prevents zero-downtime reload
process.on('SIGINT', function () {
  ldbThoughtspaces.forEach(db => {
    db.destroy()
  })
  ldbDoclogs.forEach(db => {
    db.destroy()
  })
  ldbReplicationCursors.forEach(db => {
    db.close()
  })
})

// do not start server until permissions have synced
// otherwise owners could get overwritten
permissionsServerSynced.then(() => {
  console.info('Permissions loaded')
  server.listen()
})
