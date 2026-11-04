import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code === 'EPERM' }
}

/** A live owner never loses a lock merely because its build is slow. */
export async function acquireBuildLock(file, { timeoutMs = 600_000, malformedGraceMs = 120_000, pollMs = 100, onWait } = {}) {
  const started = Date.now(), token = randomUUID()
  while (true) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() })) }
      finally { await handle.close() }
      return async () => {
        const owner = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null)
        if (owner?.pid === process.pid && owner?.token === token) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let text, stat
      try { [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.lstat(file)]) }
      catch (readError) { if (readError.code === 'ENOENT') continue; throw readError }
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe build lock path')
      let owner
      try { owner = JSON.parse(text) } catch { owner = null }
      const reclaim = owner && Number.isSafeInteger(owner.pid) && owner.pid > 0
        ? !alive(owner.pid) : Date.now() - stat.mtimeMs > malformedGraceMs
      if (reclaim) {
        // Recheck ownership/content immediately before reclaiming a dead lock.
        const current = await fs.readFile(file, 'utf8').catch(() => null)
        const currentStat = await fs.lstat(file).catch(() => null)
        if (current === text && currentStat?.ino === stat.ino && currentStat?.mtimeMs === stat.mtimeMs) {
          await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
        continue
      }
      if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for the build lock owner')
      onWait?.()
      await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(pollMs, timeoutMs - (Date.now() - started)))))
    }
  }
}
