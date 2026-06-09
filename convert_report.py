"""Convert TESTING_REPORT.md to a formatted DOCX with Times New Roman, black only."""

import re
from pathlib import Path
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BLACK = RGBColor(0, 0, 0)
TNR = "Times New Roman"
CODE_FONT = "Courier New"

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def set_run_font(run, size_pt, bold=False, italic=False, code=False):
    run.font.name = CODE_FONT if code else TNR
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = BLACK
    # force East-Asian font too
    rpr = run._r.get_or_add_rPr()
    rFonts = OxmlElement("w:rFonts")
    font = CODE_FONT if code else TNR
    rFonts.set(qn("w:ascii"), font)
    rFonts.set(qn("w:hAnsi"), font)
    rFonts.set(qn("w:cs"), font)
    rpr.insert(0, rFonts)


def set_para_font(para, size_pt, bold=False, italic=False,
                  align=None, space_before=0, space_after=6):
    for run in para.runs:
        set_run_font(run, size_pt, bold=bold, italic=italic)
    pPr = para._p.get_or_add_pPr()
    # line spacing
    pPr_spacing = OxmlElement("w:spacing")
    pPr_spacing.set(qn("w:before"), str(int(space_before * 20)))
    pPr_spacing.set(qn("w:after"), str(int(space_after * 20)))
    pPr.append(pPr_spacing)
    if align:
        para.alignment = align


def add_heading(doc, text, level):
    """Add a heading with Times New Roman, black, no colour theme."""
    sizes = {1: 20, 2: 16, 3: 14, 4: 12}
    size = sizes.get(level, 12)
    para = doc.add_paragraph()
    run = para.add_run(text)
    set_run_font(run, size, bold=True)
    spacing_before = {1: 18, 2: 14, 3: 10, 4: 8}.get(level, 6)
    set_para_font(para, size, bold=True, space_before=spacing_before, space_after=4)
    return para


def apply_inline(para, text, base_size=11, code=False):
    """Parse **bold**, `code`, and plain text within a line and add runs."""
    # combined pattern: **bold**, `code`
    pattern = re.compile(r'(\*\*(.+?)\*\*|`([^`]+)`)')
    last = 0
    for m in pattern.finditer(text):
        if m.start() > last:
            run = para.add_run(text[last:m.start()])
            set_run_font(run, base_size, code=code)
        if m.group(2) is not None:      # **bold**
            run = para.add_run(m.group(2))
            set_run_font(run, base_size, bold=True, code=code)
        elif m.group(3) is not None:    # `code`
            run = para.add_run(m.group(3))
            set_run_font(run, base_size, code=True)
        last = m.end()
    if last < len(text):
        run = para.add_run(text[last:])
        set_run_font(run, base_size, code=code)


def add_paragraph(doc, text, size=11, bold=False, indent=False,
                  space_before=0, space_after=4):
    para = doc.add_paragraph()
    apply_inline(para, text, base_size=size)
    for run in para.runs:
        run.font.bold = run.font.bold or bold
    if indent:
        para.paragraph_format.left_indent = Cm(0.75)
    set_para_font(para, size, bold=bold,
                  space_before=space_before, space_after=space_after)
    return para


def add_code_block(doc, lines):
    """Add a shaded code block using a table for border effect."""
    tbl = doc.add_table(rows=1, cols=1)
    tbl.style = "Table Grid"
    cell = tbl.cell(0, 0)
    # remove default paragraph
    cell.paragraphs[0]._element.getparent().remove(cell.paragraphs[0]._element)
    for line in lines:
        p = cell.add_paragraph()
        run = p.add_run(line if line else " ")
        set_run_font(run, 8, code=True)
        pPr = p._p.get_or_add_pPr()
        sp = OxmlElement("w:spacing")
        sp.set(qn("w:before"), "0")
        sp.set(qn("w:after"), "0")
        sp.set(qn("w:line"), "240")
        sp.set(qn("w:lineRule"), "auto")
        pPr.append(sp)
    doc.add_paragraph()   # spacer after block


def set_cell_border(cell):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for side in ("top", "left", "bottom", "right"):
        tag = OxmlElement(f"w:{side}")
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), "4")
        tag.set(qn("w:color"), "000000")
        tcBorders = tcPr.find(qn("w:tcBorders"))
        if tcBorders is None:
            tcBorders = OxmlElement("w:tcBorders")
            tcPr.append(tcBorders)
        tcBorders.append(tag)


def add_table(doc, headers, rows):
    """Add a markdown-style table with Times New Roman, black borders."""
    col_count = len(headers)
    tbl = doc.add_table(rows=1 + len(rows), cols=col_count)
    tbl.style = "Table Grid"
    tbl.alignment = WD_TABLE_ALIGNMENT.LEFT

    # header row
    hdr_cells = tbl.rows[0].cells
    for i, h in enumerate(headers):
        set_cell_border(hdr_cells[i])
        hdr_cells[i].paragraphs[0].clear()
        run = hdr_cells[i].paragraphs[0].add_run(h.strip())
        set_run_font(run, 9, bold=True)
        hdr_cells[i].paragraphs[0].paragraph_format.space_after = Pt(2)

    # data rows
    for ri, row_data in enumerate(rows):
        cells = tbl.rows[ri + 1].cells
        for ci, val in enumerate(row_data):
            if ci >= col_count:
                break
            set_cell_border(cells[ci])
            cells[ci].paragraphs[0].clear()
            p = cells[ci].paragraphs[0]
            apply_inline(p, val.strip(), base_size=9)
            p.paragraph_format.space_after = Pt(2)

    doc.add_paragraph()   # spacer after table


def add_bullet(doc, text, level=0):
    para = doc.add_paragraph(style="List Bullet")
    para.paragraph_format.left_indent = Cm(0.5 + level * 0.5)
    apply_inline(para, text.strip("- ").strip(), base_size=11)
    para.paragraph_format.space_after = Pt(2)


def add_numbered(doc, text, num):
    para = doc.add_paragraph()
    run = para.add_run(f"{num}. ")
    set_run_font(run, 11, bold=False)
    apply_inline(para, text, base_size=11)
    para.paragraph_format.left_indent = Cm(0.5)
    para.paragraph_format.space_after = Pt(2)


# --------------------------------------------------------------------------- #
# parser
# --------------------------------------------------------------------------- #

def parse_table_line(line):
    """Split a markdown table row into cells."""
    cells = [c for c in line.split("|")]
    # strip outer empty cells from leading/trailing |
    if cells and cells[0].strip() == "":
        cells = cells[1:]
    if cells and cells[-1].strip() == "":
        cells = cells[:-1]
    return cells


def is_separator_row(cells):
    return all(re.match(r"^[\s:\-]+$", c) for c in cells)


def convert(md_path, docx_path):
    doc = Document()

    # --- page margins ---
    for section in doc.sections:
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
        section.left_margin = Inches(1.2)
        section.right_margin = Inches(1.2)
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)

    lines = Path(md_path).read_text(encoding="utf-8").splitlines()

    in_code = False
    code_lines = []
    in_table = False
    table_headers = []
    table_rows = []

    i = 0
    numbered_counter = {}   # indent_level -> count

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        # ------------------------------------------------------------------ #
        # code block fence
        # ------------------------------------------------------------------ #
        if stripped.startswith("```"):
            if not in_code:
                in_code = True
                code_lines = []
                i += 1
                continue
            else:
                # flush code block
                if in_table:
                    add_table(doc, table_headers, table_rows)
                    in_table = False
                    table_headers = []
                    table_rows = []
                add_code_block(doc, code_lines)
                in_code = False
                code_lines = []
                i += 1
                continue

        if in_code:
            code_lines.append(raw)
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # flush pending table when non-table line arrives
        # ------------------------------------------------------------------ #
        def maybe_flush_table():
            nonlocal in_table, table_headers, table_rows
            if in_table:
                add_table(doc, table_headers, table_rows)
                in_table = False
                table_headers = []
                table_rows = []

        # ------------------------------------------------------------------ #
        # blank line
        # ------------------------------------------------------------------ #
        if stripped == "":
            maybe_flush_table()
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # horizontal rule
        # ------------------------------------------------------------------ #
        if re.match(r"^-{3,}$", stripped) or re.match(r"^\*{3,}$", stripped):
            maybe_flush_table()
            para = doc.add_paragraph()
            pPr = para._p.get_or_add_pPr()
            pBdr = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "6")
            bottom.set(qn("w:color"), "000000")
            pBdr.append(bottom)
            pPr.append(pBdr)
            para.paragraph_format.space_before = Pt(4)
            para.paragraph_format.space_after = Pt(4)
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # headings
        # ------------------------------------------------------------------ #
        m = re.match(r"^(#{1,4})\s+(.*)", stripped)
        if m:
            maybe_flush_table()
            level = len(m.group(1))
            text = m.group(2)
            # strip markdown links [text](url) → text
            text = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", text)
            add_heading(doc, text, level)
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # markdown table
        # ------------------------------------------------------------------ #
        if stripped.startswith("|"):
            cells = parse_table_line(stripped)
            if not in_table:
                # first row = headers
                table_headers = cells
                in_table = True
            elif is_separator_row(cells):
                pass   # skip separator
            else:
                table_rows.append(cells)
            i += 1
            continue
        else:
            maybe_flush_table()

        # ------------------------------------------------------------------ #
        # bullet list
        # ------------------------------------------------------------------ #
        m_bullet = re.match(r"^(\s*)[-*]\s+(.*)", raw)
        if m_bullet:
            indent = len(m_bullet.group(1)) // 2
            add_bullet(doc, m_bullet.group(2), level=indent)
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # numbered list
        # ------------------------------------------------------------------ #
        m_num = re.match(r"^(\s*)(\d+)\.\s+(.*)", raw)
        if m_num:
            add_numbered(doc, m_num.group(3), m_num.group(2))
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # blockquote  (> text)
        # ------------------------------------------------------------------ #
        m_bq = re.match(r"^>\s+(.*)", stripped)
        if m_bq:
            para = doc.add_paragraph()
            apply_inline(para, m_bq.group(1), base_size=10)
            para.paragraph_format.left_indent = Cm(1.0)
            para.paragraph_format.space_after = Pt(4)
            i += 1
            continue

        # ------------------------------------------------------------------ #
        # regular paragraph
        # ------------------------------------------------------------------ #
        # strip markdown links
        text = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", stripped)
        if text:
            para = doc.add_paragraph()
            apply_inline(para, text, base_size=11)
            para.paragraph_format.space_after = Pt(4)
        i += 1

    # flush any trailing table
    if in_table:
        add_table(doc, table_headers, table_rows)

    doc.save(docx_path)
    print(f"Saved: {docx_path}")


if __name__ == "__main__":
    src = Path("/Users/simonaristovska/Desktop/Software-Quality-Testing-Project/TESTING_REPORT.md")
    dst = Path("/Users/simonaristovska/Desktop/TESTING_REPORT.docx")
    convert(src, dst)
