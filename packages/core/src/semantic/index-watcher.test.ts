import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Instance } from '../project/instance.js'
const state = vi.hoisted(() => ({
  data: '', roots: [] as string[], callbacks: [] as Array<(error: Error | null, events: {path:string}[])=>void>,
  index: vi.fn(), clear: vi.fn(), unsubscribe: vi.fn(async()=>{}),
}))
vi.mock('../global/index.js',()=>({Global:{Path:{get data(){return state.data}}}}))
vi.mock('./indexer.js',()=>({Indexer:{indexProjectIncremental:state.index,isIndexableFile:(file:string)=>file.endsWith('.ts')}}))
vi.mock('./index-filters.js',()=>({shouldIgnoreIndexedFile:()=>false,clearProjectIndexFilterCache:state.clear}))
vi.mock('@parcel/watcher',()=>({subscribe:vi.fn(async(_root:string,callback:any)=>{
  state.roots.push(_root); state.callbacks.push(callback); return {unsubscribe:state.unsubscribe}
})}))
import { IndexWatcher } from './index-watcher.js'
let directory:string,root:string,canonicalRoot:string
let handles:IndexWatcher.Handle[]=[]
beforeEach(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'sensegrep-watcher-integration-'))
  root=path.join(directory,'project'); state.data=path.join(directory,'data')
  await fs.mkdir(root); await fs.writeFile(path.join(root,'package.json'),'{}')
  canonicalRoot=await fs.realpath(root)
  state.callbacks=[];state.roots=[];state.index.mockReset();state.clear.mockClear();state.unsubscribe.mockClear()
  state.index.mockResolvedValue({});handles=[]
})
afterEach(async()=>{
  await Promise.all(handles.map(handle=>handle.stop()))
  await fs.rm(directory,{recursive:true,force:true})
})
async function start(profile='default', target=root) {
  const handle=await Instance.provide({directory:target,profile,fn:()=>IndexWatcher.start({rootDir:target,intervalMs:5})})
  handles.push(handle);return handle
}
function edit(index=0,file='source.ts'){state.callbacks[index](null,[{path:path.join(state.roots[index],file)}])}
describe('watcher integration',()=>{
  it('subscribes and processes events under the canonical root when started through an alias',async()=>{
    const alias=path.join(directory,'alias')
    await fs.symlink(root,alias,process.platform === 'win32' ? 'junction' : 'dir')
    await start('default',alias)
    expect(state.roots).toEqual([canonicalRoot])
    edit()
    await vi.waitFor(()=>expect(state.index).toHaveBeenCalledTimes(1))
  })
  it('captures the profile and isolates locks for the same root',async()=>{
    const observed:string[]=[]
    state.index.mockImplementation(async()=>{observed.push(Instance.profile);return {}})
    await start('first');await start('second');await start('first')
    expect(state.callbacks).toHaveLength(2)
    expect(state.roots).toEqual([canonicalRoot,canonicalRoot])
    edit(0);edit(1)
    await vi.waitFor(()=>expect(observed.sort()).toEqual(['first','second']))
  })
  it('retries a failed update without requiring another edit',async()=>{
    state.index.mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValue({})
    await start();edit()
    await vi.waitFor(()=>expect(state.index).toHaveBeenCalledTimes(2))
  })
  it('keeps edits arriving during an active update',async()=>{
    let release!:()=>void
    state.index.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({})}))
    await start();edit()
    await vi.waitFor(()=>expect(state.index).toHaveBeenCalledTimes(1))
    edit();release()
    await vi.waitFor(()=>expect(state.index).toHaveBeenCalledTimes(2))
  })
  it('reconciles ignore changes rather than ignoring the event',async()=>{
    await start();edit(0,'.gitignore')
    await vi.waitFor(()=>expect(state.index).toHaveBeenCalledTimes(1))
    expect(state.clear).toHaveBeenCalledWith(canonicalRoot)
  })
  it('cancels and awaits active work before allowing the next watcher',async()=>{
    let settled=false
    state.index.mockImplementationOnce(({signal})=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>setTimeout(()=>{settled=true;reject(signal.reason)},10),{once:true})
    }))
    const handle=await start();edit()
    await vi.waitFor(()=>expect(state.index).toHaveBeenCalledTimes(1))
    await handle.stop();expect(settled).toBe(true)
    await start();expect(state.callbacks).toHaveLength(2)
  })
})
