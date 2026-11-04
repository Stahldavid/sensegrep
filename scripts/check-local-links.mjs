import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
export function missingLocalLinks(file) {
  const content = readFileSync(file, 'utf8')
  return [...content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1]).filter(target => !/^(?:[a-z]+:|#|\/\/)/i.test(target))
    .filter(target => !existsSync(path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]))))
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = process.argv.slice(2)
  if (!files.length) throw new Error('Pass Markdown files to check')
  let failures = 0
  for (const file of files) for (const target of missingLocalLinks(file)) {console.error(`${file}: missing ${target}`); failures++}
  console.log(JSON.stringify({files:files.length,missing:failures}))
  process.exitCode = failures ? 1 : 0
}
