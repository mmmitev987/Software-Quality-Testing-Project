"""Insert the class-grouping explanation paragraph after the 2.2 table in the existing DOCX."""

from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

TNR = "Times New Roman"
BLACK = RGBColor(0, 0, 0)

DOCX_PATH = "/Users/simonaristovska/Desktop/TESTING_REPORT.docx"

TEXT = (
    "Why we grouped tests into classes: Each class corresponds to one function under test "
    "(e.g. CanDeleteTests contains all tests for can_delete). This makes it immediately clear "
    "which function a failing test belongs to, allows shared setup code (setup_method) to be "
    "written once instead of repeated in every test, and keeps the 203 tests navigable across "
    "7 files. pytest collects these classes automatically because pyproject.toml sets "
    "python_classes = '*Tests' — every class whose name ends in Tests is picked up as a test container."
)

doc = Document(DOCX_PATH)

# Find the paragraph that contains "TOTAL" and "203" — that's the last row marker
# After the table containing that text, insert our paragraph.
target_index = None
for i, block in enumerate(doc.paragraphs):
    if "24 classes" in block.text or "203" in block.text:
        target_index = i
        break

# Also search inside tables — the TOTAL row is inside a table
# We need to find the table and insert a paragraph after it
target_table_index = None
for i, table in enumerate(doc.tables):
    for row in table.rows:
        cell_texts = [c.text for c in row.cells]
        if any("TOTAL" in t for t in cell_texts) and any("203" in t for t in cell_texts):
            target_table_index = i
            break
    if target_table_index is not None:
        break

if target_table_index is not None:
    # Get the table element and insert a paragraph after it
    table = doc.tables[target_table_index]
    table_element = table._tbl

    # Create new paragraph element
    new_para = OxmlElement("w:p")
    new_run = OxmlElement("w:r")
    new_rpr = OxmlElement("w:rPr")

    # Font
    rFonts = OxmlElement("w:rFonts")
    rFonts.set(qn("w:ascii"), TNR)
    rFonts.set(qn("w:hAnsi"), TNR)
    new_rpr.append(rFonts)

    # Size 11pt
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "22")
    new_rpr.append(sz)

    # Color black
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "000000")
    new_rpr.append(color)

    new_run.append(new_rpr)

    # Text node
    t = OxmlElement("w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = TEXT
    new_run.append(t)
    new_para.append(new_run)

    # Paragraph spacing
    pPr = OxmlElement("w:pPr")
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:before"), "120")
    spacing.set(qn("w:after"), "120")
    pPr.append(spacing)
    new_para.insert(0, pPr)

    # Insert after the table
    table_element.addnext(new_para)
    print(f"Inserted paragraph after table {target_table_index}")
else:
    print("Could not find the TOTAL/203 table — check table content")
    for i, table in enumerate(doc.tables):
        print(f"Table {i}:")
        for row in table.rows:
            print("  ", [c.text[:30] for c in row.cells])

doc.save(DOCX_PATH)
print("Saved.")
