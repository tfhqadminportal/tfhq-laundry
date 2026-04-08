"""
Generate the weekly laundry log paper template.

Layout (replaces the earlier merged-column version):
  - A4 LANDSCAPE, one page, 5 day tables stacked vertically.
  - Columns per day (13): Size | Paykel(Blue/White/Grey) | Daniel(Blue/White/Grey)
    | Stewart(Blue/White/Grey) | Ink | Holes | Repair
  - Two-row header so "Paykel / Daniel / Stewart" span their 3 colour cells.
  - Weekly totals strip at the bottom (bags + labelling + total gowns).
"""

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas

SIZES = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
DAYS  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

NAVY = colors.HexColor('#0b2545')
SOFT = colors.HexColor('#e6eef8')
STRIPE = colors.HexColor('#f6f7fa')
WARM = colors.HexColor('#fff8e1')

# Column widths in mm — must fit in ~273 mm usable landscape width
SIZE_W   = 12
COLOUR_W = 16                           # each colour cell per building
BUILDING_W = COLOUR_W * 3               # 48mm per building
REJECT_W = 17
TOTAL_COLS_W = SIZE_W + BUILDING_W * 3 + REJECT_W * 3  # = 12 + 144 + 51 = 207 mm
HEADER_H = 7
ROW_H    = 4.6
DAY_LABEL_H = 4
DAY_GAP = 2


def draw_day_table(c, x, y, day_label):
    """Draw one day's table with a two-row header. Returns (width, total_height used)."""
    total_w = TOTAL_COLS_W * mm
    hdr1_h = HEADER_H * mm
    hdr2_h = HEADER_H * mm
    rows_h = ROW_H * mm * len(SIZES)
    table_h = hdr1_h + hdr2_h + rows_h

    # Day label above the table
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(x, y + 1 * mm, day_label)
    c.setFillColor(colors.black)

    top = y - DAY_LABEL_H * mm
    bottom = top - table_h

    # ── Row 1 header: spanning groups ────────────────────────
    col_x = x
    # Size (spans both header rows)
    c.setFillColor(NAVY)
    c.rect(col_x, top - (hdr1_h + hdr2_h), SIZE_W * mm, hdr1_h + hdr2_h, stroke=1, fill=1)
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', 7)
    c.drawCentredString(col_x + (SIZE_W * mm) / 2, top - (hdr1_h + hdr2_h) / 2 - 1, 'Size')
    col_x += SIZE_W * mm

    # Paykel / Daniel / Stewart group headers (row 1)
    for bname in ('Paykel', 'Daniel', 'Stewart'):
        c.setFillColor(NAVY)
        c.rect(col_x, top - hdr1_h, BUILDING_W * mm, hdr1_h, stroke=1, fill=1)
        c.setFillColor(colors.white)
        c.setFont('Helvetica-Bold', 8)
        c.drawCentredString(col_x + (BUILDING_W * mm) / 2, top - hdr1_h + 2, bname)
        col_x += BUILDING_W * mm

    # Rejects group header (spans Ink/Holes/Repair)
    rejects_total_w = REJECT_W * 3 * mm
    c.setFillColor(NAVY)
    c.rect(col_x, top - hdr1_h, rejects_total_w, hdr1_h, stroke=1, fill=1)
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', 8)
    c.drawCentredString(col_x + rejects_total_w / 2, top - hdr1_h + 2, 'Rejects')

    # ── Row 2 header: colour sub-columns & reject sub-columns ─
    col_x = x + SIZE_W * mm
    c.setFont('Helvetica-Bold', 6.5)
    for _ in range(3):  # three buildings
        for sub, fill in [('Blue', colors.HexColor('#cfe3ff')),
                          ('White', colors.white),
                          ('Grey', colors.HexColor('#d9d9d9'))]:
            c.setFillColor(fill)
            c.rect(col_x, top - hdr1_h - hdr2_h, COLOUR_W * mm, hdr2_h, stroke=1, fill=1)
            c.setFillColor(colors.black)
            c.drawCentredString(col_x + (COLOUR_W * mm) / 2, top - hdr1_h - hdr2_h + 2, sub)
            col_x += COLOUR_W * mm

    for sub in ('Ink', 'Holes', 'Repair'):
        c.setFillColor(colors.HexColor('#ffe0e0') if sub == 'Ink'
                       else colors.HexColor('#ffe9cf') if sub == 'Holes'
                       else colors.HexColor('#fff1c8'))
        c.rect(col_x, top - hdr1_h - hdr2_h, REJECT_W * mm, hdr2_h, stroke=1, fill=1)
        c.setFillColor(colors.black)
        c.drawCentredString(col_x + (REJECT_W * mm) / 2, top - hdr1_h - hdr2_h + 2, sub)
        col_x += REJECT_W * mm

    # ── Data rows (one per size) ──────────────────────────────
    c.setFont('Helvetica', 8)
    row_top = top - hdr1_h - hdr2_h
    for ri, s in enumerate(SIZES):
        row_bot = row_top - ROW_H * mm
        stripe = ri % 2 == 0
        # Size label cell
        c.setFillColor(STRIPE if stripe else colors.white)
        c.rect(x, row_bot, SIZE_W * mm, ROW_H * mm, stroke=1, fill=1)
        c.setFillColor(colors.black)
        c.setFont('Helvetica-Bold', 8)
        c.drawCentredString(x + SIZE_W * mm / 2, row_bot + 1.5, s)

        # Gown cells (9)
        col_x = x + SIZE_W * mm
        c.setFont('Helvetica', 8)
        for _ in range(9):
            c.setFillColor(colors.white)
            c.rect(col_x, row_bot, COLOUR_W * mm, ROW_H * mm, stroke=1, fill=1)
            col_x += COLOUR_W * mm

        # Reject cells (3)
        for _ in range(3):
            c.setFillColor(colors.white)
            c.rect(col_x, row_bot, REJECT_W * mm, ROW_H * mm, stroke=1, fill=1)
            col_x += REJECT_W * mm
        row_top = row_bot

    used = (y - row_top) + 0.5 * mm
    return total_w, used


def build(filepath):
    page_w, page_h = landscape(A4)
    c = canvas.Canvas(filepath, pagesize=landscape(A4))
    c.setTitle('TFHQ Laundry — Weekly Log')

    # Header bar
    c.setFillColor(NAVY)
    c.rect(0, page_h - 11 * mm, page_w, 11 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', 13)
    c.drawString(10 * mm, page_h - 7 * mm, 'TFHQ LAUNDRY — Weekly Log')
    c.setFont('Helvetica', 8)
    c.drawRightString(page_w - 10 * mm, page_h - 7 * mm, 'Week of: _____________________')

    # Instructions
    c.setFillColor(colors.black)
    c.setFont('Helvetica-Oblique', 7)
    c.drawString(
        10 * mm, page_h - 14 * mm,
        'Write the gown count in each Blue / White / Grey cell.  Rejects (Ink, Holes, Repair) are per size — only fill those where applicable.',
    )

    # 5 day tables stacked vertically
    x0 = 10 * mm
    y  = page_h - 17 * mm
    for day in DAYS:
        _, used = draw_day_table(c, x0, y, day)
        y -= used + DAY_GAP * mm

    # Weekly totals strip at the bottom
    strip_h = 14 * mm
    strip_y = y
    c.setStrokeColor(NAVY)
    c.setFillColor(STRIPE)
    c.rect(10 * mm, strip_y - strip_h, page_w - 20 * mm, strip_h, stroke=1, fill=1)

    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(13 * mm, strip_y - 5 * mm, 'Weekly totals (fill in at end of week)')
    c.setFillColor(colors.black)
    c.setFont('Helvetica', 8.5)
    labels = [
        ('Paykel bags: ________',  13),
        ('Daniel bags: ________',  63),
        ('Stewart bags: ________',113),
        ('Total labelled: ________', 168),
        ('Total gowns (week): ________', 228),
    ]
    for text, x_mm in labels:
        c.drawString(x_mm * mm, strip_y - 11 * mm, text)

    c.showPage()
    c.save()


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else 'weekly_form.pdf'
    build(out)
    print(f'Wrote {out}')
