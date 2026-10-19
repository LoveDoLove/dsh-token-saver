import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// Isolate the plugin's persistent settings store from the developer machine's
// live ~/.dsh settings: unit tests must never read or write the real DSH home.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-saver-test-home-'))
process.env.DSH_HOME = tmp
