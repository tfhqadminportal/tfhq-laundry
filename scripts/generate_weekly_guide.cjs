// Generate "TFHQ Laundry - Weekly Photo Upload Guide.docx"
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  TabStopType, TabStopPosition, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak,
} = require('docx')
const fs = require('fs')

const NAVY = '0b2545'
const GOLD = 'c5a253'

const border = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
const cellBorders = { top: border, bottom: border, left: border, right: border }

// Helper: heading paragraph
const H1 = text => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true })],
})
const H2 = text => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true })],
})

const P  = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text, ...opts })],
})
const Mono = text => new Paragraph({
  spacing: { after: 120 },
  shading: { fill: 'F3F4F6', type: ShadingType.CLEAR },
  children: [new TextRun({ text, font: 'Courier New', size: 20 })],
})

// Bullet item
const B = text => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 60 },
  children: [new TextRun({ text })],
})
// Numbered item
const N = text => new Paragraph({
  numbering: { reference: 'numbers', level: 0 },
  spacing: { after: 60 },
  children: [new TextRun({ text })],
})

// Info/warning callout box (as a 1x1 table)
const callout = (label, body, fill) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [9360],
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 180, right: 180 },
      borders: cellBorders,
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: label, bold: true })],
        }),
        new Paragraph({ children: [new TextRun({ text: body })] }),
      ],
    })],
  })],
})

const doc = new Document({
  creator: 'Total Facility HQ',
  title: 'TFHQ Laundry — Weekly Photo Upload Guide',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: NAVY },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: NAVY },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } },
        }],
      },
      {
        reference: 'numbers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },             // A4 portrait
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // ~2 cm
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Total Facility HQ · Weekly Photo Upload Guide · April 2026', color: '888888', size: 18 })],
        })],
      }),
    },
    children: [
      // ─── Title ─────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: [new TextRun({ text: 'TFHQ Laundry App', bold: true, size: 40, color: NAVY })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: 'Weekly Photo Upload — Setup & How-To', size: 28, color: GOLD, bold: true })],
      }),
      P('Fazeel asked for a faster way to submit the weekly laundry log. This guide covers the new photo-upload workflow — how to set it up once, how Fazeel uses it each week, and what you (admin + accounts) see on your side.'),

      // ─── What changed ──────────────────────────────────────
      H1("What's changed"),
      B('Fazeel now fills in ONE simplified weekly sheet (Mon–Fri on a single page) with just two building columns: "Daniel/Paykel" and "Stewart".'),
      B('Every Friday he snaps a photo of the sheet and uploads it in the app. Claude Vision reads it, fills the numbers in automatically, and he just reviews and submits.'),
      B('On your admin/accounts view, Paykel, Daniel and Stewart still appear as three separate buildings. The app auto-splits the Daniel/Paykel column 80% Paykel / 20% Daniel behind the scenes.'),
      B('The old per-day manual entry form is still available at /log/manual if you ever need it.'),

      // ─── One-time setup ───────────────────────────────────
      H1('One-time setup'),

      H2('1. Get an Anthropic API key'),
      P('Claude Vision reads the handwritten sheet. At one photo per week this costs roughly NZ $1 per year — effectively free, but you still need an API key.'),
      N('Go to https://console.anthropic.com and sign in (or create an account).'),
      N('Click Get API Keys in the left sidebar, then Create Key.'),
      N('Name it something like "TFHQ Laundry — Vercel".'),
      N('Copy the key (starts with sk-ant-…). You will only see it once — keep it somewhere safe.'),
      N('Add a small amount of credit (NZ $5 will last years at this volume).'),

      H2('2. Add the key to Vercel'),
      N('Go to https://vercel.com and open the TFHQ Laundry project.'),
      N('Click Settings → Environment Variables.'),
      N('Add a new variable:'),
      Mono('Name:  ANTHROPIC_API_KEY'),
      Mono('Value: sk-ant-...    (the key you copied)'),
      Mono('Environments: Production, Preview, Development (tick all three)'),
      N('Click Save, then go to Deployments and click Redeploy on the latest deployment so the new env var takes effect.'),

      callout(
        'Why Vercel?',
        'The OCR request is handled by a Vercel serverless function (/api/ocr-laundry) so your API key never touches the browser. Fazeel does not need the key on his phone — only the server does.',
        'E6EEF8'
      ),
      new Paragraph({ spacing: { after: 120 }, children: [] }),

      H2('3. Print the new weekly paper form'),
      B('Print "TFHQ Laundry — Weekly Paper Form.pdf" (also saved in the TFHQ Laundry folder).'),
      B('It is A4 landscape with one small table per weekday and a weekly totals strip at the bottom.'),
      B('Only 2 building columns — Daniel/Paykel and Stewart — so Fazeel writes half as many numbers as before.'),
      B('Give Fazeel a stack; he uses one per week.'),

      // ─── Fazeel's weekly workflow ──────────────────────────
      new Paragraph({ children: [new PageBreak()] }),
      H1("Fazeel's weekly workflow"),
      N('Mon–Fri: fills in the sheet as usual. For Daniel/Paykel he writes the COMBINED number for both buildings in a single cell.'),
      N('Friday afternoon: totals each day at the bottom of each day column.'),
      N('Fills in the weekly totals strip: Daniel/Paykel bags, Stewart bags, Total labelled, Total gowns.'),
      N('Opens the TFHQ Laundry app on his phone and taps Weekly Log Upload (this is now the default staff screen).'),
      N('Picks the correct Week starting (Monday) date.'),
      N('Taps Choose photo and either takes a new photo or picks one from the gallery.'),
      N('Waits ~10–20 seconds while Claude reads the sheet.'),
      N('Reviews the extracted numbers — any cell can be tapped and corrected.'),
      N('Taps Submit week. All 5 days are saved at once.'),

      callout(
        'Tip for a clean OCR',
        'Good lighting, whole sheet visible, camera held flat (not at an angle). The app automatically downsizes the image before sending to Claude, so a normal phone photo is fine.',
        'FFF4D6'
      ),
      new Paragraph({ spacing: { after: 120 }, children: [] }),

      // ─── Admin/accounts view ───────────────────────────────
      H1('Admin & Accounts view'),
      P('Nothing changes for you — you still see Paykel, Daniel and Stewart as three separate buildings, with per-day rows. The only difference is how the numbers get there.'),

      H2('The 80/20 split — worked example'),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2000, 2453, 2453, 2454],
        rows: [
          new TableRow({
            tableHeader: true,
            children: ['Size', 'Sheet: Daniel/Paykel', 'Saved: Paykel (80%)', 'Saved: Daniel (20%)'].map(h =>
              new TableCell({
                width: { size: h === 'Size' ? 2000 : 2453, type: WidthType.DXA },
                shading: { fill: NAVY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                borders: cellBorders,
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })] })],
              })
            ),
          }),
          ...[
            ['XS',  '76',  '61', '15'],
            ['M',   '226', '181', '45'],
            ['XL',  '229', '183', '46'],
            ['3XL', '192', '154', '38'],
            ['5XL', '104', '83',  '21'],
            ['7XL', '112', '90',  '22'],
          ].map(row => new TableRow({
            children: row.map((v, i) => new TableCell({
              width: { size: i === 0 ? 2000 : 2453, type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              borders: cellBorders,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v })] })],
            })),
          })),
        ],
      }),
      new Paragraph({ spacing: { before: 120, after: 120 }, children: [new TextRun({ text: 'The split is applied per cell, per day. Totals always match the original sheet.', italics: true, color: '555555' })] }),

      H2('Where weekly bags + labelling appear'),
      B('Weekly bag counts and total labelled are saved on Friday\'s daily-extras entry in the admin view.'),
      B('Daniel/Paykel bag count is split 80/20 the same way as gowns.'),
      B('This keeps your existing Accounts screen and Xero invoice logic working without any changes.'),

      // ─── Troubleshooting ───────────────────────────────────
      H1('Troubleshooting'),

      H2('"Server is missing ANTHROPIC_API_KEY"'),
      B('The Vercel env var was not added, or the deployment was not redeployed after adding it. Re-check Step 2 above.'),

      H2('"Could not find Paykel / Daniel / Stewart buildings"'),
      B('The buildings must be named exactly "Paykel", "Daniel" and "Stewart" (case-insensitive) in the client setup.'),
      B('Open Admin → Clients → Fisher & Paykel Healthcare → Manage and make sure all three are present and active.'),

      H2('Numbers look wrong after OCR'),
      B('Every cell is editable in the review step — just tap and type the correct number before pressing Submit.'),
      B('If a whole day looks off, check that the sheet was photographed flat and the day labels ("30/3" etc.) are readable.'),

      H2('Cost tracking'),
      B('Go to https://console.anthropic.com → Usage to see per-request cost. At 1 upload/week you should see roughly NZ $0.01 per week.'),

      // ─── Quick reference ───────────────────────────────────
      H1('Quick reference'),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3120, 6240],
        rows: [
          ['Staff screen', '/log/new — Weekly Log Upload (photo)'],
          ['Old manual form', '/log/manual (still works, admin only)'],
          ['OCR endpoint', '/api/ocr-laundry (Vercel function)'],
          ['Required env var', 'ANTHROPIC_API_KEY'],
          ['Split ratio', '80% Paykel / 20% Daniel'],
          ['Paper form PDF', 'TFHQ Laundry - Weekly Paper Form.pdf'],
        ].map((row, idx) => new TableRow({
          children: row.map((v, i) => new TableCell({
            width: { size: i === 0 ? 3120 : 6240, type: WidthType.DXA },
            shading: idx % 2 === 0 ? { fill: 'F6F7FA', type: ShadingType.CLEAR } : undefined,
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            borders: cellBorders,
            children: [new Paragraph({ children: [new TextRun({ text: v, bold: i === 0 })] })],
          })),
        })),
      }),
    ],
  }],
})

Packer.toBuffer(doc).then(buf => {
  const out = process.argv[2] || 'TFHQ Laundry - Weekly Photo Upload Guide.docx'
  fs.writeFileSync(out, buf)
  console.log('Wrote', out)
})
