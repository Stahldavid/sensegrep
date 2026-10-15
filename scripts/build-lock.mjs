import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code === 'EPERM' }
}

async function readLock(file) {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe build lock path')
    const text = await fs.readFile(file, 'utf8')
    let owner
    try { owner = JSON.parse(text) } catch { owner = null }
    return {stat, text, owner}
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function reclaimable(lock, malformedGraceMs) {
  return lock.owner && Number.isSafeInteger(lock.owner.pid) && lock.owner.pid > 0
    ? !alive(lock.owner.pid) : Date.now() - lock.stat.mtimeMs > malformedGraceMs
}

/** A live owner never loses a lock merely because its build is slow.
 * Reclaimers serialize through an exclusive guard and re-read ownership under it.
 * An abandoned reclamation guard fails closed: remove it only after checking
 * that no builder/reclaimer is active. It is never reclaimed recursively.
 */
export async function acquireBuildLock(file, { timeoutMs = 600_000, malformedGraceMs = 120_000, pollMs = 100, onWait } = {}) {
  const started = Date.now(), token = randomUUID(), guardPath = `${file}.reclaim`
  while (true) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() })) }
      finally { await handle.close() }
      return async () => {
        const lock = await readLock(file)
        if (lock?.owner?.pid === process.pid && lock.owner.token === token) {
          await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const lock = await readLock(file)
      if (!lock) continue
      if (reclaimable(lock, malformedGraceMs)) {
        let guard
        try { guard = await fs.open(guardPath, 'wx', 0o600) }
        catch (guardError) { if (guardError.code !== 'EEXIST') throw guardError }
        if (guard) {
          try {
            await guard.writeFile(JSON.stringify({pid:process.pid,token}))
            const current = await readLock(file)
            if (current && reclaimable(current, malformedGraceMs)) {
              await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
            }
          } finally {
            await guard.close()
            await fs.unlink(guardPath).catch(error => { if (error.code !== 'ENOENT') throw error })
          }
          continue
        }
      }
      if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for the build lock owner or reclamation guard')
      onWait?.()
      await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(pollMs, timeoutMs - (Date.now() - started)))))
    }
  }
}
