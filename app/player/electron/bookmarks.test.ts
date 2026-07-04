import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBookmarksFile, writeBookmarksFile } from './bookmarks'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saimin4-bookmarks-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('readBookmarksFile', () => {
  it('ファイル無しは null（初回起動＝移行判定のため {} と区別）', () => {
    expect(readBookmarksFile(path.join(dir, 'bookmarks.json'))).toBeNull()
  })

  it('正常な JSON オブジェクトをそのまま返す', () => {
    const file = path.join(dir, 'bookmarks.json')
    const marks = { A: { code: 'A', index: 1, line: 0, savedAt: 100 } }
    fs.writeFileSync(file, JSON.stringify(marks))
    expect(readBookmarksFile(file)).toEqual(marks)
  })

  it('破損 JSON・オブジェクト以外は {}（null にしない＝再移行を起こさない）', () => {
    const file = path.join(dir, 'bookmarks.json')
    fs.writeFileSync(file, '{broken')
    expect(readBookmarksFile(file)).toEqual({})
    fs.writeFileSync(file, '[1,2]')
    expect(readBookmarksFile(file)).toEqual({})
    fs.writeFileSync(file, '"str"')
    expect(readBookmarksFile(file)).toEqual({})
  })
})

describe('writeBookmarksFile', () => {
  it('書き込み→読み出しがラウンドトリップし、tmp を残さない', () => {
    const file = path.join(dir, 'bookmarks.json')
    const marks = { A: { code: 'A', index: 2, line: 1, savedAt: 200 } }
    writeBookmarksFile(file, marks)
    expect(readBookmarksFile(file)).toEqual(marks)
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  it('親ディレクトリが無ければ作成し、既存ファイルは上書きする', () => {
    const file = path.join(dir, 'nested', 'deep', 'bookmarks.json')
    writeBookmarksFile(file, { A: { savedAt: 1 } })
    writeBookmarksFile(file, {})
    expect(readBookmarksFile(file)).toEqual({})
  })
})
