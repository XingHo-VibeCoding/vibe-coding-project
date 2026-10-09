/* 造一个最小的教务导出 xlsx（zip，只用 store 存储，不压缩）——给 onboarding 相关脚本共用。
   列口径 = P12a 的 8 列：课程代码|课程名称|教师姓名|学期|上课时间|上课地点|选课时间|选课志愿；
   每行必须给满 8 个值，少一个整行就左移一列（P12a 踩过的坑）。 */
const enc = new TextEncoder()

export async function makeEduXlsx() {
  const shared = [
    '课程代码', '课程名称', '教师姓名', '学期', '上课时间', '上课地点', '选课时间', '选课志愿',
    'EDU001', '高等数学', '张老师', '秋冬', '周一第1,2节{1-16周}',
    '紫金港东1-101;紫金港东1-102', '2026-09-01', '第一志愿',
    'EDU002', '大学英语', '李老师', '秋冬', '周三第3,4节{1-16周}',
    '紫金港西2-201', '2026-09-01', '第一志愿',
  ]
  const ss = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('') + '</sst>'
  const cell = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`
  const rows = []
  for (let r = 0; r < 3; r++) {
    const cols = 'ABCDEFGH'.split('').map((c, i) => cell(c + (r + 1), r * 8 + i)).join('')
    rows.push(`<row r="${r + 1}">${cols}</row>`)
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  const wb = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="课表" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const wbRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  const ct = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  const parts = [
    ['[Content_Types].xml', ct],
    ['_rels/.rels', rootRels],
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', wbRels],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/sharedStrings.xml', ss],
  ]
  const crcTable = (() => {
    const tbl = new Int32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c }
    return tbl
  })()
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, text] of parts) {
    const nameBuf = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBuf.length + data.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, data.length, true)
    dv.setUint16(26, nameBuf.length, true)
    local.set(nameBuf, 30)
    local.set(data, 30 + nameBuf.length)
    chunks.push(local)
    const cd = new Uint8Array(46 + nameBuf.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBuf.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBuf, 46)
    central.push(cd)
    offset += local.length
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, parts.length, true)
  ev.setUint16(10, parts.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0))
  let p = 0
  for (const a of all) { out.set(a, p); p += a.length }
  return out
}
