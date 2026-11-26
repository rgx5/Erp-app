"""Builds the quotation as a Word file (Aptos) and a PDF preview of it.
   python3 build_docx.py            (CLIENT="..." ATTN="..." DATE="..." to fill in the names)"""
import os, subprocess
from docx import Document
from docx.shared import Pt, Mm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); A = HERE + '/assets/'
CLIENT = os.environ.get('CLIENT', 'Client Company Name')
ATTN = os.environ.get('ATTN', 'Sir / Madam')
DATE = os.environ.get('DATE', '26 November 2026')
SIGNER = 'Rohan Gosavi'
FONT = 'Aptos'
INK = RGBColor(0x0F, 0x1A, 0x2B); MUTED = RGBColor(0x55, 0x61, 0x76); BLUE = RGBColor(0x13, 0x77, 0xD3); DEEP = RGBColor(0x0B, 0x4F, 0x94)

d = Document()
s = d.sections[0]
s.page_width, s.page_height = Mm(210), Mm(297)
s.left_margin = s.right_margin = Mm(20); s.top_margin = Mm(18); s.bottom_margin = Mm(18)
s.different_first_page_header_footer = True

def font(style_or_run, size=None, bold=None, color=None, name=FONT):
    f = style_or_run.font
    f.name = name
    rpr = (style_or_run.element.get_or_add_rPr() if hasattr(style_or_run, 'element') and hasattr(style_or_run.element, 'get_or_add_rPr') else style_or_run._element.get_or_add_rPr())
    rf = rpr.find(qn('w:rFonts'))
    if rf is None: rf = OxmlElement('w:rFonts'); rpr.append(rf)
    for k in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'): rf.set(qn(k), name)
    if size: f.size = Pt(size)
    if bold is not None: f.bold = bold
    if color is not None: f.color.rgb = color

st = d.styles['Normal']; font(st, 10.5, color=INK)
st.paragraph_format.space_after = Pt(6); st.paragraph_format.line_spacing = 1.18

def para(text='', size=10.5, bold=False, color=INK, after=6, before=0, align=None, keep=False, container=None, italic=False):
    p = (container or d).add_paragraph()
    p.paragraph_format.space_after = Pt(after); p.paragraph_format.space_before = Pt(before)
    if align: p.alignment = align
    if keep: p.paragraph_format.keep_with_next = True
    if text:
        r = p.add_run(text); font(r, size, bold, color); r.italic = italic
    return p

def run(p, text, size=10.5, bold=False, color=INK):
    r = p.add_run(text); font(r, size, bold, color); return r

def shade(cell, hexcolor):
    tcPr = cell._element.get_or_add_tcPr(); sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear'); sh.set(qn('w:color'), 'auto'); sh.set(qn('w:fill'), hexcolor); tcPr.append(sh)

def borders(cell, **kw):  # top/bottom/left/right = (size, color) or None
    tcPr = cell._element.get_or_add_tcPr(); b = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        e = OxmlElement(f'w:{edge}'); v = kw.get(edge)
        if v: e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), str(v[0])); e.set(qn('w:color'), v[1]); e.set(qn('w:space'), '0')
        else: e.set(qn('w:val'), 'nil')
        b.append(e)
    tcPr.append(b)

def margins(cell, top=60, bottom=60, left=100, right=100):
    tcPr = cell._element.get_or_add_tcPr(); m = OxmlElement('w:tcMar')
    for k, v in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        e = OxmlElement(f'w:{k}'); e.set(qn('w:w'), str(v)); e.set(qn('w:type'), 'dxa'); m.append(e)
    tcPr.append(m)

def table(rows, cols, widths):
    t = d.add_table(rows=rows, cols=cols); t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.autofit = False
    tblPr = t._tbl.tblPr; lay = OxmlElement('w:tblLayout'); lay.set(qn('w:type'), 'fixed'); tblPr.append(lay)
    for i, col in enumerate(t.columns): col.width = Mm(widths[i])
    for row in t.rows:
        for i, c in enumerate(row.cells): c.width = Mm(widths[i])
    return t

def rule(color='1377D3', size=18, after=8, before=0):
    p = d.add_paragraph(); p.paragraph_format.space_after = Pt(after); p.paragraph_format.space_before = Pt(before)
    pPr = p._p.get_or_add_pPr(); pb = OxmlElement('w:pBdr'); b = OxmlElement('w:bottom')
    b.set(qn('w:val'), 'single'); b.set(qn('w:sz'), str(size)); b.set(qn('w:space'), '1'); b.set(qn('w:color'), color); pb.append(b); pPr.append(pb)
    return p

def page_break(): d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

def field(p, code, size=8.5):
    r = p.add_run(); font(r, size, color=MUTED)
    for t, txt in (('begin', None), (None, code), ('end', None)):
        if t: e = OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'), t); r._r.append(e)
        else: i = OxmlElement('w:instrText'); i.set(qn('xml:space'), 'preserve'); i.text = txt; r._r.append(i)

# footer (not on the cover)
fp = s.footer.paragraphs[0]; fp.paragraph_format.space_before = Pt(0)
run(fp, 'Rapid Rabbit Labs Private Limited  ·  Quotation for ' + CLIENT + '  ·  Page ', 8.5, False, MUTED); field(fp, 'PAGE')
fp.alignment = WD_ALIGN_PARAGRAPH.LEFT

# ───────────────────────── 1 · cover ─────────────────────────
lp = d.add_paragraph(); lp.paragraph_format.space_after = Pt(0); lp.add_run().add_picture(A + 'logo.png', width=Mm(52))
para('', after=60)
para('Rapid Rabbit Labs Private Limited', 26, True, INK, after=2)
para('IT solutions and software development  ·  Pune, India', 12, False, MUTED, after=0)
rule('1377D3', 24, after=34, before=10)
para('QUOTATION', 13, True, BLUE, after=4)
para('Business management software\nfor your solar company', 27, True, INK, after=30)
para('PREPARED FOR', 9, True, MUTED, after=2)
para(CLIENT, 22, True, DEEP, after=40)
t = table(1, 3, [52, 58, 60])
for i, (k, v) in enumerate((('DATE', DATE), ('QUOTATION NO.', '_______________'), ('PREPARED BY', 'Rapid Rabbit Labs Private Limited'))):
    c = t.rows[0].cells[i]; borders(c, top=(8, 'DBE4EF')); margins(c, 100, 40, 0, 100)
    p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(2); run(p, k, 8.5, True, MUTED)
    p2 = c.add_paragraph(); p2.paragraph_format.space_after = Pt(0); run(p2, v, 11, True, INK)
page_break()

# ───────────────────────── 2 · cover letter ─────────────────────────
photo = A + 'solar.jpg'
if os.path.exists(photo):
    im = Image.open(photo); W, H = im.size; target = 170 / 80  # mm ratio of the strip
    h = int(W / target); y0 = max(0, int((H - h) * 0.5)); im.crop((0, y0, W, y0 + h)).save(A + 'solar-strip.jpg', quality=92)
    p = d.add_paragraph(); p.paragraph_format.space_after = Pt(2); p.add_run().add_picture(A + 'solar-strip.jpg', width=Mm(170))
    credit = open(A + 'credit.txt').read().strip() if os.path.exists(A + 'credit.txt') else ''
    if credit: para(credit, 7, False, MUTED, after=10, align=WD_ALIGN_PARAGRAPH.RIGHT)
else:
    para('[ solar panel close-up photo goes here ]', 10, False, MUTED, after=60, align=WD_ALIGN_PARAGRAPH.CENTER)
para(DATE, 10, False, MUTED, after=10)
para('Dear ' + ATTN + ',', after=8)
para('Thank you for giving Rapid Rabbit Labs the opportunity to quote for ' + CLIENT + '. This quotation is for a business management software made for a solar company. It brings your enquiries, site surveys, proposals, quotations, projects, subsidies, stock, billing, accounts and after-sales service into one system, used by your whole team on a computer and on a phone.')
para('The next pages list the features you will get. We have also set out the timeline: fifteen days for development, followed by fifteen days of testing and improvements with your team. The software runs on the cloud with a daily backup, and our team supports you during business hours.')
para('The costing is on the last page, along with the yearly renewal of ₹25,000.')
para('If you want anything added, changed or taken out, tell us and we will send you a revised quotation.')
para('Regards,', after=22, before=4)
para(SIGNER, bold=True, after=0)
para('Rapid Rabbit Labs Private Limited, Pune', color=MUTED)
page_break()

# ───────────────────────── 3–4 · features ─────────────────────────
def head(title, sub=None):
    para(title, 20, True, INK, after=2, keep=True)
    if sub: para(sub, 10.5, False, MUTED, after=6)
    rule('DBE4EF', 8, after=8)

FEATURES = [
 ('1', 'Enquiries and customers', ['Enquiry capture: manual entry, website form, Facebook / Instagram and Google ad leads', 'Source tracking, assignment to team members, follow-up reminders', 'Pipeline view from new enquiry to order', 'Customer records with GSTIN, addresses and contacts', 'Complete history of every customer: quotations, invoices, payments, service']),
 ('2', 'Site survey', ['Survey form: roof type and area, shade, sanctioned load, electricity company, consumer number, monthly units', 'Electricity bill and site photos attached to the survey', 'Filled on the phone at site, even without internet', 'Survey becomes the starting point of the quotation']),
 ('3', 'Proposals and quotations', ['Ready-made kits (for example 3 kW, 5 kW, 10 kW) with panels, inverter, structure, cables and accessories', 'Price per kW or per item, GST calculated automatically, margin visible', 'Several options and versions for one customer', 'Branded PDF proposal with system details, savings, payback, subsidy and finance option', 'Send by WhatsApp or email, then convert to an order in one click']),
 ('4', 'Projects', ['Every order becomes a project with stages: survey, design, electricity company application, material, installation, commissioning, net meter, handover', 'Checklists, owners and dates for each stage', 'Documents and installation photos stored with the project', 'Customer signature at handover', 'Status board showing which projects are stuck and why']),
 ('5', 'Subsidy and net-metering tracking', ['Central and state scheme for each customer', 'Application number, status, dates, expected and received subsidy amount', 'List of subsidies pending and net-meter approvals pending', 'Reminders for follow-up']),
 ('6', 'Inventory and purchases', ['Items with HSN and GST rate; panels and inverters tracked by serial number and warranty period', 'Multiple warehouses, stock set aside for a project, reorder alerts', 'Purchase orders, goods received, supplier bills and supplier payments', 'Stock on hand, valuation and movement reports']),
 ('7', 'Billing and payments', ['GST tax invoices, bills of supply, proforma invoices, credit and debit notes', 'Stage-wise billing: advance, material delivery, commissioning', 'E-invoice (IRN) and e-way bill files', 'Receipts matched to invoices, payment reminders on WhatsApp', 'Cheque tracking: received, deposited, cleared or bounced', 'Receivables ageing by customer']),
 ('8', 'Accounts and GST', ['Full double-entry accounts that update from every sale, purchase and receipt', 'Profit and loss, balance sheet, trial balance, cash flow', 'Bank statement import and reconciliation', 'GSTR-1 and GSTR-3B working, input tax credit register, GSTR-2B reconciliation', 'TDS, expense vouchers and period locking']),
 ('9', 'After-sales and service', ['Yearly maintenance contracts with automatic invoices', 'Scheduled cleaning and inspection visits', 'Complaint tickets with assignment and status', 'Warranty claims on manufacturers using the recorded serial numbers', 'Service history for every installed system']),
 ('10', 'Reports and dashboard', ['Dashboard: enquiries, orders, kW sold and installed, receivables, cash and bank', 'Project-wise profit: revenue less material, labour and commission', 'Subsidy, net-meter and payment-due lists', 'Export of every report to Excel / CSV']),
 ('11', 'Mobile app for your team', ['Android app for site staff and sales team', 'Site survey, photos, installation checklist and handover signature', 'Customer and quotation details on the go', 'Works offline and syncs when the network returns']),
 ('12', 'Users, security and administration', ['Roles and permissions: each person sees only what they should', 'Audit trail of who changed what and when', 'Approvals for discounts and large payments', 'Import of existing customers, items and balances from Excel / CSV', 'Screens in English, Hindi, Marathi and Gujarati']),
]

def module_cell(c, num, title, bullets):
    margins(c, 120, 120, 150, 130); borders(c, top=(12, '1377D3'), bottom=(4, 'DBE4EF'), left=(4, 'DBE4EF'), right=(4, 'DBE4EF'))
    p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(3); p.paragraph_format.keep_with_next = True
    run(p, num + '   ', 11.5, True, BLUE); run(p, title, 12.5, True, DEEP)
    for b in bullets:
        bp = c.add_paragraph(); bp.paragraph_format.space_after = Pt(3); bp.paragraph_format.left_indent = Mm(3.2); bp.paragraph_format.first_line_indent = Mm(-3.2); bp.paragraph_format.line_spacing = 1.12
        run(bp, '•  ', 10.3, True, BLUE); run(bp, b, 10.3, False, INK)

head('What we are providing', 'The software, with these features, for ' + CLIENT + '.')
def feature_grid(items):
    for i in range(0, len(items), 2):
        t = table(1, 3, [83, 4, 83])  # a narrow gap column
        for col, it in ((0, items[i]), (2, items[i + 1] if i + 1 < len(items) else None)):
            if it: module_cell(t.rows[0].cells[col], *it)
        for c in t.rows[0].cells: c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
        # keep a row from splitting across pages
        trPr = t.rows[0]._tr.get_or_add_trPr(); cs = OxmlElement('w:cantSplit'); trPr.append(cs)
        sp = d.add_paragraph(); sp.paragraph_format.space_after = Pt(0); sp.paragraph_format.line_spacing = Pt(9)
feature_grid(FEATURES[:6]); page_break()
head('What we are providing', 'continued')
feature_grid(FEATURES[6:]); page_break()

# ───────────────────────── 5 · timeline, hosting, support ─────────────────────────
head('Timeline, hosting and support')
para('Delivery timeline', 13, True, DEEP, after=4, keep=True)
t = table(4, 3, [46, 28, 96])
hdr = ('Stage', 'Duration', 'What happens')
rows = [('Development', '15 days', 'We build and set up the software with the features in this quotation, and load your customers, items and opening balances.'),
        ('Testing and improvement', '15 days', 'Your team uses the software on real work. We fix what is found and make improvements you ask for within the scope of this quotation.'),
        ('Total', '30 days', 'From the start date we agree with you.')]
for i, h in enumerate(hdr):
    c = t.rows[0].cells[i]; shade(c, 'EEF5FC'); margins(c, 70, 70, 110, 80); borders(c, bottom=(12, '0F1A2B')); c.paragraphs[0].paragraph_format.space_after = Pt(0); run(c.paragraphs[0], h.upper(), 8.5, True, MUTED)
for r_i, row in enumerate(rows, start=1):
    for i, v in enumerate(row):
        c = t.rows[r_i].cells[i]; margins(c, 80, 80, 110, 80); borders(c, bottom=(4, 'DBE4EF')); c.paragraphs[0].paragraph_format.space_after = Pt(0)
        run(c.paragraphs[0], v, 10.2, i < 2 or row[0] == 'Total', INK)
para('', after=10)

def block(title, lines):
    t = table(1, 1, [170]); c = t.rows[0].cells[0]; shade(c, 'EEF5FC'); margins(c, 120, 120, 180, 150); borders(c, left=(36, '1377D3'))
    p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(3); run(p, title, 12.5, True, DEEP)
    for l in lines:
        q = c.add_paragraph(); q.paragraph_format.space_after = Pt(2); run(q, l, 10.2, False, INK)
    para('', after=8)
block('Cloud hosting and daily backup', ['The software is hosted on the cloud, so your team can use it from the office, from home and from site.', 'A backup of your data is taken every day and kept safely in the cloud.'])
block('Support during business hours', ['Our team is available to help during business hours by phone, WhatsApp and email.', 'Problems with the software are fixed by us; questions on how to do something are answered.'])
block('Yearly renewal', ['Renewal is ₹25,000 per year (plus GST as applicable).'])
page_break()

# ───────────────────────── 6 · costing and acceptance ─────────────────────────
head('Costing')
t = table(8, 2, [118, 52])
items = ['Software development and set-up', 'Mobile app (Android)', 'Cloud hosting and daily backup', 'Support during business hours', 'Subtotal', 'GST', 'Total']
for i, h in enumerate(('Item', 'Amount (₹)')):
    c = t.rows[0].cells[i]; shade(c, 'EEF5FC'); margins(c, 70, 70, 110, 110); borders(c, bottom=(12, '0F1A2B')); c.paragraphs[0].paragraph_format.space_after = Pt(0); run(c.paragraphs[0], h.upper(), 8.5, True, MUTED)
    if i == 1: c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
for r_i, name in enumerate(items, start=1):
    tot = name in ('Subtotal', 'GST', 'Total')
    for i in (0, 1):
        c = t.rows[r_i].cells[i]; margins(c, 110, 110, 110, 110); borders(c, bottom=(4 if not name == 'Total' else 12, 'DBE4EF' if name != 'Total' else '0F1A2B'))
        c.paragraphs[0].paragraph_format.space_after = Pt(0)
        if i == 0: run(c.paragraphs[0], name, 10.5, tot, INK)
para('', after=8)
t = table(1, 2, [118, 52]); 
for i, (txt, b) in enumerate((('Yearly renewal', True), ('₹ 25,000 per year', True))):
    c = t.rows[0].cells[i]; shade(c, 'EEF5FC'); margins(c, 120, 120, 110, 110); borders(c, left=(36, '1377D3') if i == 0 else None)
    c.paragraphs[0].paragraph_format.space_after = Pt(0); run(c.paragraphs[0], txt, 11.5, b, DEEP if i == 0 else INK)
    if i == 1: c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
para('All amounts are in Indian rupees. GST is charged as applicable.', 9, False, MUTED, after=14, before=6)

para('Terms', 13, True, DEEP, after=4, keep=True)
t = table(3, 2, [52, 118])
for r_i, (k, v) in enumerate((('Payment terms', '______________________________________________'), ('Quotation valid until', '______________________________________________'), ('Start date', '______________________________________________'))):
    for i, x in enumerate((k, v)):
        c = t.rows[r_i].cells[i]; margins(c, 100, 100, 110, 80); borders(c, bottom=(4, 'DBE4EF')); c.paragraphs[0].paragraph_format.space_after = Pt(0); run(c.paragraphs[0], x, 10.5, i == 0, INK if i == 0 else MUTED)

para('', after=14)
para('Acceptance', 13, True, DEEP, after=8, keep=True)
t = table(1, 3, [55, 5, 110])
c1, c2, c3 = t.rows[0].cells
for c, (a, b) in ((c1, (SIGNER, 'Rapid Rabbit Labs Private Limited')), (c3, ('Accepted for ' + CLIENT, 'Name, signature and date'))):
    borders(c, top=(12, '1377D3')); margins(c, 80, 0, 0, 0)
    p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, a, 10.5, True, INK)
    q = c.add_paragraph(); q.paragraph_format.space_after = Pt(0); run(q, b, 9.5, False, MUTED)

out = HERE + '/Rapid-Rabbit-Labs-Quotation.docx'
d.save(out)
subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', HERE, out], capture_output=True)
print('saved', out)
