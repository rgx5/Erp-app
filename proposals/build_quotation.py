"""Enterprise-format quotation (Word, Aptos) + PDF preview.   python3 build_quotation.py
   Fill in with:  CLIENT="..." ATTN="..." DATE="..." python3 build_quotation.py"""
import os, re, subprocess, json
from docx import Document
from docx.shared import Pt, Mm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); A = HERE + '/assets/'
CLIENT = os.environ.get('CLIENT', 'Client Company Name'); ATTN = os.environ.get('ATTN', 'Sir / Madam')
DATE = os.environ.get('DATE', '27 November 2026'); SIGNER = 'Rohan Gosavi'; FONT = 'Aptos'
INK = RGBColor(0x0F, 0x1A, 0x2B); MUTED = RGBColor(0x55, 0x61, 0x76); BLUE = RGBColor(0x13, 0x77, 0xD3); DEEP = RGBColor(0x0B, 0x4F, 0x94)
LINE = 'D5DDE8'

# ───────────────────────────── content ─────────────────────────────
MODULES = [
 ('Enquiry and customer management', 'Enquiries from every source, follow-ups, pipeline and a complete customer record.', [
   ('Enquiry capture', 'Record enquiries manually, or receive them from the website form and from Facebook, Instagram and Google ad leads.'),
   ('Source and ownership', 'Every enquiry carries its source and is assigned to a team member.'),
   ('Follow-up management', 'Reminders for the next call, and a log of calls and messages against each enquiry.'),
   ('Sales pipeline', 'Stage-wise view of enquiries from new to order, with conversion reports by source and by person.'),
   ('Customer master', 'Customer details, GSTIN, addresses and contacts, with the full history of quotations, invoices, payments and service for each customer.')]),
 ('Site survey', 'A standard survey of the customer’s site, captured on the phone.', [
   ('Survey form', 'Roof type and area, shade, sanctioned load, electricity company, consumer number and monthly units consumed.'),
   ('Attachments', 'Electricity bill, site photos and measurements attached to the survey.'),
   ('Offline capture', 'The survey can be filled at site without internet and synchronises when the connection returns.'),
   ('Link to quotation', 'The survey is the starting point of the quotation, so details are not entered twice.')]),
 ('Proposals and quotations', 'Quotations built from ready-made kits, with a branded proposal document.', [
   ('Kit templates', 'Ready-made kits, for example 3 kW, 5 kW and 10 kW, with panels, inverter, structure, cables and accessories.'),
   ('Pricing', 'Price per kW or per item, GST calculated automatically, margin visible to authorised users.'),
   ('Options and versions', 'Several options and revisions for the same customer, with every version kept.'),
   ('Proposal document', 'Branded PDF with system details, expected savings, payback, subsidy and finance option.'),
   ('Sharing and conversion', 'Send by WhatsApp or email, and convert the accepted quotation into an order in one step.')]),
 ('Project management', 'Every order runs as a project with stages, owners, documents and photos.', [
   ('Project stages', 'Survey, design, electricity company application, material, installation, commissioning, net meter and handover.'),
   ('Checklists and ownership', 'A checklist, an owner and a due date for each stage.'),
   ('Documents and photos', 'Application forms, certificates, test reports and installation photos stored with the project.'),
   ('Handover', 'Customer acceptance and signature recorded at handover.'),
   ('Status board', 'All projects by stage, with those that are delayed or waiting highlighted.')]),
 ('Subsidy and net-metering tracking', 'Subsidy and net-meter status for every customer in one place.', [
   ('Scheme record', 'Central or state scheme applied for, with application number and dates.'),
   ('Status tracking', 'Current status of the subsidy and of the net-meter approval.'),
   ('Amounts', 'Expected and received subsidy amount for each customer.'),
   ('Pending lists', 'Lists of subsidies pending and net-meter approvals pending, with reminders for follow-up.')]),
 ('Inventory and purchases', 'Stock of panels, inverters and accessories, and buying from suppliers.', [
   ('Item master', 'Items with HSN code, GST rate and units.'),
   ('Serial and warranty tracking', 'Panels and inverters tracked by serial number with warranty period, linked to the customer they were installed for.'),
   ('Warehouses and reservations', 'Stock in more than one location, and stock set aside for a project.'),
   ('Reorder alerts', 'Alerts when an item falls below its minimum level.'),
   ('Purchasing', 'Purchase orders, goods received, supplier bills and supplier payments.'),
   ('Stock reports', 'Stock on hand, valuation and movement.')]),
 ('Sales billing and payments', 'Invoicing, collection and follow-up of payments.', [
   ('Sales documents', 'GST tax invoices, bills of supply, proforma invoices, credit notes and debit notes.'),
   ('Stage-wise billing', 'Invoices for advance, material delivery and commissioning against the same order.'),
   ('E-invoice and e-way bill', 'Files for e-invoice (IRN) and e-way bill generation.'),
   ('Receipts', 'Receipts matched to invoices, with advances held against the customer.'),
   ('Payment reminders', 'Reminders to customers by WhatsApp, with a record of each reminder sent.'),
   ('Cheque management', 'Cheques received, deposited, cleared or bounced, with the accounting entries made at the right time.'),
   ('Receivables ageing', 'Outstanding amounts by customer and by age.')]),
 ('Accounts and GST', 'Accounts that update from every transaction, and GST working.', [
   ('Double-entry accounting', 'Every sale, purchase and receipt posts to the accounts automatically; journals for manual entries.'),
   ('Financial statements', 'Profit and loss, balance sheet, trial balance and cash flow.'),
   ('Bank reconciliation', 'Import of bank statements and matching with the books.'),
   ('GST returns working', 'GSTR-1 and GSTR-3B working, input tax credit register and GSTR-2B reconciliation.'),
   ('TDS and expenses', 'Tax deducted at source on payments, and expense vouchers.'),
   ('Period locking', 'Closed periods cannot be changed.')]),
 ('After-sales and service', 'Maintenance contracts, visits, complaints and warranty claims.', [
   ('Maintenance contracts', 'Yearly maintenance contracts with automatic invoices.'),
   ('Scheduled visits', 'Cleaning and inspection visits scheduled and assigned.'),
   ('Complaint tickets', 'Complaints logged with owner, status and resolution.'),
   ('Warranty claims', 'Claims on manufacturers prepared with the recorded serial numbers.'),
   ('Service history', 'Every installed system carries its complete service history.')]),
 ('Reports and dashboard', 'Management information for owners and department heads.', [
   ('Dashboard', 'Enquiries, orders, kW sold and installed, receivables, cash and bank at a glance.'),
   ('Project profitability', 'Revenue less material, labour and commission, project by project.'),
   ('Operational lists', 'Subsidy pending, net meter pending, payments due and stock to reorder.'),
   ('Export', 'Every report can be exported to Excel or CSV.')]),
 ('Mobile app', 'An Android app for the sales and site teams.', [
   ('Site work', 'Site survey, photos, installation checklist and handover signature.'),
   ('On-the-go information', 'Customer and quotation details available on the phone.'),
   ('Offline operation', 'Works without internet and synchronises when the network returns.')]),
 ('Users, security and administration', 'Control over who can see and do what.', [
   ('Roles and permissions', 'Each user sees and does only what their role allows.'),
   ('Audit trail', 'A record of who changed what and when.'),
   ('Approvals', 'Approval steps for discounts and large payments.'),
   ('Data import', 'Import of existing customers, items and balances from Excel or CSV.'),
   ('Languages', 'Screens available in English, Hindi, Marathi and Gujarati.')]),
]

# ───────────────────────────── helpers ─────────────────────────────
def build(pages):
    d = Document(); s = d.sections[0]
    s.page_width, s.page_height = Mm(210), Mm(297)
    s.left_margin = s.right_margin = Mm(20); s.top_margin = Mm(24); s.bottom_margin = Mm(20)
    s.header_distance = Mm(10); s.footer_distance = Mm(9)
    s.different_first_page_header_footer = True

    def fnt(obj, size=None, bold=None, color=None):
        f = obj.font; f.name = FONT
        el = obj.element if hasattr(obj, 'element') else obj._element
        rpr = el.get_or_add_rPr(); rf = rpr.find(qn('w:rFonts'))
        if rf is None: rf = OxmlElement('w:rFonts'); rpr.append(rf)
        for k in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'): rf.set(qn(k), FONT)
        if size: f.size = Pt(size)
        if bold is not None: f.bold = bold
        if color is not None: f.color.rgb = color

    n = d.styles['Normal']; fnt(n, 10.5, color=INK); n.paragraph_format.space_after = Pt(6); n.paragraph_format.line_spacing = 1.2
    for name, size, color, before, after in (('Heading 1', 17, INK, 0, 4), ('Heading 2', 12.5, DEEP, 12, 3)):
        h = d.styles[name]; fnt(h, size, True, color); h.font.italic = False
        h.paragraph_format.space_before = Pt(before); h.paragraph_format.space_after = Pt(after); h.paragraph_format.keep_with_next = True

    brk = [False]
    def take(p):
        if brk[0]: p.paragraph_format.page_break_before = True; brk[0] = False
        return p
    def para(text='', size=10.5, bold=False, color=INK, after=6, before=0, align=None, keep=False, italic=False):
        p = take(d.add_paragraph()); p.paragraph_format.space_after = Pt(after); p.paragraph_format.space_before = Pt(before)
        if align is not None: p.alignment = align
        if keep: p.paragraph_format.keep_with_next = True
        if text: r = p.add_run(text); fnt(r, size, bold, color); r.italic = italic
        return p
    def run(p, text, size=10.5, bold=False, color=INK):
        r = p.add_run(text); fnt(r, size, bold, color); return r
    def border_bottom(p, color='0F1A2B', size=8, space=4):
        pPr = p._p.get_or_add_pPr(); pb = OxmlElement('w:pBdr'); b = OxmlElement('w:bottom')
        b.set(qn('w:val'), 'single'); b.set(qn('w:sz'), str(size)); b.set(qn('w:space'), str(space)); b.set(qn('w:color'), color); pb.append(b); pPr.append(pb)
    def h1(num, text):
        p = take(d.add_paragraph(style='Heading 1')); run(p, f'{num}.  {text}' if num else text, 17, True, INK); border_bottom(p, '1377D3', 12, 6); p.paragraph_format.space_after = Pt(10); p.paragraph_format.space_before = Pt(0 if p.paragraph_format.page_break_before else 22); return p
    def h2(num, text):
        p = d.add_paragraph(style='Heading 2'); run(p, f'{num}   {text}', 12.5, True, DEEP); return p
    def pagebreak(): brk[0] = True
    def cell_borders(cell, **kw):
        tcPr = cell._element.get_or_add_tcPr(); b = OxmlElement('w:tcBorders')
        for edge in ('top', 'left', 'bottom', 'right'):
            e = OxmlElement(f'w:{edge}'); v = kw.get(edge)
            if v: e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), str(v[0])); e.set(qn('w:color'), v[1]); e.set(qn('w:space'), '0')
            else: e.set(qn('w:val'), 'nil')
            b.append(e)
        tcPr.append(b)
    def cell_margins(cell, top=70, bottom=70, left=80, right=80):
        tcPr = cell._element.get_or_add_tcPr(); m = OxmlElement('w:tcMar')
        for k, v in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
            e = OxmlElement(f'w:{k}'); e.set(qn('w:w'), str(v)); e.set(qn('w:type'), 'dxa'); m.append(e)
        tcPr.append(m)
    def new_table(rows, widths):
        t = d.add_table(rows=rows, cols=len(widths)); t.alignment = WD_TABLE_ALIGNMENT.LEFT; t.autofit = False
        lay = OxmlElement('w:tblLayout'); lay.set(qn('w:type'), 'fixed'); t._tbl.tblPr.append(lay)
        for i, col in enumerate(t.columns): col.width = Mm(widths[i])
        for row in t.rows:
            for i, c in enumerate(row.cells): c.width = Mm(widths[i])
            trPr = row._tr.get_or_add_trPr(); trPr.append(OxmlElement('w:cantSplit'))
        return t
    def ruled(headers, rows, widths, bold_first=False, right=(), total_last=False, size=10):
        """A plain ruled table: a heavy line under the header, hairlines between rows, no boxes and no shading."""
        t = new_table(len(rows) + 1, widths)
        for i, h in enumerate(headers):
            c = t.rows[0].cells[i]; cell_margins(c, 60, 60, 60, 60); cell_borders(c, bottom=(10, '0F1A2B'))
            p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, h.upper(), 8.3, True, MUTED)
            if i in right: p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        tr = t.rows[0]._tr.get_or_add_trPr(); tr.append(OxmlElement('w:tblHeader'))
        for r_i, row in enumerate(rows, start=1):
            last = total_last and r_i == len(rows)
            for i, v in enumerate(row):
                c = t.rows[r_i].cells[i]; cell_margins(c, 62, 62, 60, 60); cell_borders(c, bottom=(10 if last else 4, '0F1A2B' if last else LINE), top=(10, '0F1A2B') if last else None)
                p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); p.paragraph_format.line_spacing = 1.12
                run(p, v, size, (bold_first and i == 0) or last, INK)
                if i in right: p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        para('', after=4)
        return t
    def field(p, code, size=8.5):
        r = p.add_run(); fnt(r, size, color=MUTED)
        for kind in ('begin', 'code', 'end'):
            if kind == 'code': e = OxmlElement('w:instrText'); e.set(qn('xml:space'), 'preserve'); e.text = code
            else: e = OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'), kind)
            r._r.append(e)

    # running header and footer (not on the cover)
    hp = s.header.paragraphs[0]; hp.paragraph_format.space_after = Pt(0)
    hp.paragraph_format.tab_stops.add_tab_stop(Mm(170), WD_TAB_ALIGNMENT.RIGHT)
    hp.add_run().add_picture(A + 'logo.png', height=Mm(8)); run(hp, '\tQuotation for ' + CLIENT, 8.5, False, MUTED); border_bottom(hp, LINE, 6, 5)
    fp = s.footer.paragraphs[0]; fp.paragraph_format.tab_stops.add_tab_stop(Mm(170), WD_TAB_ALIGNMENT.RIGHT)
    border_top = OxmlElement('w:pBdr'); tb = OxmlElement('w:top'); tb.set(qn('w:val'), 'single'); tb.set(qn('w:sz'), '6'); tb.set(qn('w:space'), '6'); tb.set(qn('w:color'), LINE); border_top.append(tb); fp._p.get_or_add_pPr().append(border_top)
    run(fp, 'Rapid Rabbit Labs Private Limited  ·  Confidential\tPage ', 8.5, False, MUTED); field(fp, 'PAGE'); run(fp, ' of ', 8.5, False, MUTED); field(fp, 'NUMPAGES')

    # ───────── cover (unchanged) ─────────
    lp = take(d.add_paragraph()); lp.paragraph_format.space_after = Pt(0); lp.add_run().add_picture(A + 'logo.png', width=Mm(52))
    para('', after=60)
    para('Rapid Rabbit Labs Private Limited', 26, True, INK, after=2)
    para('IT solutions and software development  ·  Pune, India', 12, False, MUTED, after=0)
    p = para('', after=34, before=10); border_bottom(p, '1377D3', 24, 1)
    para('QUOTATION', 13, True, BLUE, after=4)
    para('Business management software\nfor your solar company', 27, True, INK, after=30)
    para('PREPARED FOR', 9, True, MUTED, after=2)
    para(CLIENT, 22, True, DEEP, after=40)
    t = new_table(1, [52, 58, 60])
    for i, (k, v) in enumerate((('DATE', DATE), ('QUOTATION NO.', '_______________'), ('PREPARED BY', 'Rapid Rabbit Labs Private Limited'))):
        c = t.rows[0].cells[i]; cell_borders(c, top=(8, LINE)); cell_margins(c, 100, 40, 0, 100)
        p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(2); run(p, k, 8.5, True, MUTED)
        p2 = c.add_paragraph(); p2.paragraph_format.space_after = Pt(0); run(p2, v, 11, True, INK)
    pagebreak()

    # ───────── covering letter ─────────
    photo = A + 'solar.jpg'
    if os.path.exists(photo):
        im = Image.open(photo); W, H = im.size; h = int(W / (170 / 70)); y0 = max(0, int((H - h) * 0.5)); im.crop((0, y0, W, y0 + h)).save(A + 'solar-strip.jpg', quality=92)
        p = take(d.add_paragraph()); p.paragraph_format.space_after = Pt(2); p.add_run().add_picture(A + 'solar-strip.jpg', width=Mm(170))
        credit = open(A + 'credit.txt').read().strip() if os.path.exists(A + 'credit.txt') else ''
        para(credit, 7, False, MUTED, after=8, align=WD_ALIGN_PARAGRAPH.RIGHT) if credit else para('', after=6)
    para('Covering letter', 17, True, INK, after=10)
    para(DATE, 10, False, MUTED, after=8)
    para('To,', after=0); para(CLIENT, bold=True, after=0); para('Kind attention: ' + ATTN, color=MUTED, after=10)
    para('Subject: Quotation for business management software', bold=True, after=8)
    para('Dear ' + ATTN + ',', after=8)
    para('Thank you for giving Rapid Rabbit Labs Private Limited the opportunity to quote for ' + CLIENT + '. This document is our quotation for a business management software made for a solar company. It brings enquiries, site surveys, proposals, quotations, projects, subsidies, stock, billing, accounts and after-sales service into one system, used by your whole team on a computer and on a phone.')
    para('The scope and features are set out in sections 2 and 3. The delivery plan is in section 5: fifteen days of development, followed by fifteen days of testing and improvements with your team. Hosting, daily backup and support are in section 6, and the costing, including the yearly renewal of ₹25,000, is in section 7.')
    para('If you would like anything added, changed or removed, please tell us and we will issue a revised quotation.')
    para('Yours sincerely,', after=24, before=4)
    para(SIGNER, bold=True, after=0); para('Rapid Rabbit Labs Private Limited, Pune', color=MUTED)
    pagebreak()

    # ───────── contents and document information ─────────
    para('Contents', 17, True, INK, after=4); p = para('', after=10); border_bottom(p, '1377D3', 12, 1)
    toc = [(1, '1', 'Executive summary'), (1, '2', 'Scope of work'), (2, '2.1', 'Objective'), (2, '2.2', 'Modules included'), (2, '2.3', 'Not included'),
           (1, '3', 'Solution description')] + [(2, f'3.{i+1}', m[0]) for i, m in enumerate(MODULES)] + [
           (1, '4', 'Deliverables'), (1, '5', 'Delivery plan and timeline'), (1, '6', 'Hosting, backup and support'), (1, '7', 'Costing'), (1, '8', 'Commercial and general terms'), (1, '9', 'Acceptance')]
    for lvl, num, title in toc:
        p = d.add_paragraph(); p.paragraph_format.space_after = Pt(2 if lvl == 2 else 3); p.paragraph_format.space_before = Pt(5 if lvl == 1 else 0)
        p.paragraph_format.left_indent = Mm(0 if lvl == 1 else 9)
        p.paragraph_format.tab_stops.add_tab_stop(Mm(170), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        run(p, f'{num}   {title}', 10.5 if lvl == 1 else 9.8, lvl == 1, INK if lvl == 1 else MUTED)
        run(p, '\t' + str(pages.get(num, '')), 10 if lvl == 1 else 9.5, lvl == 1, INK if lvl == 1 else MUTED)
    para('', after=14)
    para('Document information', 12.5, True, DEEP, after=4, keep=True)
    ruled(['Item', 'Detail'], [('Document', 'Quotation for business management software'), ('Client', CLIENT), ('Quotation number', '_______________'), ('Date', DATE), ('Version', '1.0'), ('Prepared by', 'Rapid Rabbit Labs Private Limited, Pune'), ('Valid until', '_______________')], [48, 122], bold_first=True)
    pagebreak()

    # ───────── 1 executive summary ─────────
    h1('1', 'Executive summary')
    para('Rapid Rabbit Labs Private Limited proposes to supply ' + CLIENT + ' with a business management software designed for solar companies, covering the work from the first customer enquiry to after-sales service.')
    para('The software is hosted on the cloud and used from the office computer and from an Android phone. Its modules cover enquiries and customers, site surveys, proposals and quotations, projects, subsidy tracking, inventory and purchases, billing and payments, accounts and GST, after-sales service, reports and administration. These are described in section 3.')
    para('Development will take fifteen days and will be followed by fifteen days of testing and improvement with your team. After go-live, the data is backed up on the cloud every day and our team supports your users during business hours.')
    para('Summary', 12.5, True, DEEP, after=4, before=8, keep=True)
    ruled(['Item', 'Summary'], [
        ('Solution', 'Business management software for a solar company: web and Android'),
        ('Modules', '12 modules, listed in section 3'),
        ('Development', '15 days'),
        ('Testing and improvement', '15 days'),
        ('Hosting', 'Cloud'),
        ('Backup', 'Daily, on the cloud'),
        ('Support', 'During business hours'),
        ('Yearly renewal', '₹25,000 per year'),
    ], [48, 122], bold_first=True)
    pagebreak()

    # ───────── 2 scope ─────────
    h1('2', 'Scope of work')
    h2('2.1', 'Objective')
    para('To provide one system in which ' + CLIENT + ' can record and follow every customer from enquiry to after-sales service, price and quote installations, run projects, track subsidies, manage stock and purchases, bill and collect payments, and keep accounts and GST in order.')
    h2('2.2', 'Modules included')
    ruled(['No.', 'Module', 'Purpose'], [(f'3.{i+1}', m[0], m[1]) for i, m in enumerate(MODULES)], [14, 56, 100], bold_first=False)
    h2('2.3', 'Not included')
    para('The following are not part of this quotation unless agreed in writing:')
    for t_ in ('Charges of third-party services used with the software, such as WhatsApp business messaging and SMS, and customisation beyond the features in section 3.',
               'Direct filing on government or electricity-company portals. Applications, status and documents are tracked in the software; submission on the portals is done by your team.',
               'Computers, phones, printers and other hardware.'):
        p = d.add_paragraph(); p.paragraph_format.left_indent = Mm(6); p.paragraph_format.first_line_indent = Mm(-4); p.paragraph_format.space_after = Pt(3); run(p, '–  ' + t_, 10.5)
    pagebreak()

    # ───────── 3 solution description ─────────
    h1('3', 'Solution description')
    para('Each module below lists its features. The reference in the first column can be used in the acceptance test and in any change request.', color=MUTED)
    for i, (title, purpose, feats) in enumerate(MODULES, start=1):
        h2(f'3.{i}', title)
        para(purpose, 10, False, MUTED, after=4, keep=True)
        ruled(['Ref.', 'Feature', 'Description'], [(f'3.{i}.{j}', f, dsc) for j, (f, dsc) in enumerate(feats, start=1)], [16, 44, 110], size=9.8)

    pagebreak()

    # ───────── 4 deliverables ─────────
    h1('4', 'Deliverables')
    para('On completion, Rapid Rabbit Labs Private Limited will deliver:')
    ruled(['No.', 'Deliverable', 'Description'], [
        ('4.1', 'Configured software', 'All modules in section 3, set up for ' + CLIENT + ', hosted on the cloud.'),
        ('4.2', 'Android app', 'The mobile app for the sales and site teams.'),
        ('4.3', 'Data import', 'Existing customers, items and opening balances loaded from the Excel or CSV files you provide.'),
        ('4.4', 'User set-up', 'Users, roles and permissions created as agreed with you.'),
        ('4.5', 'Backup', 'Daily cloud backup of your data, as described in section 6.'),
        ('4.6', 'Testing and improvement', 'Support through fifteen days of testing with your team, and the fixes and improvements arising from it.'),
    ], [14, 50, 106])

    # ───────── 5 delivery plan ─────────
    h1('5', 'Delivery plan and timeline')
    h2('5.1', 'Phases')
    ruled(['Phase', 'Duration', 'Activities', 'Outcome'], [
        ('1  Development', '15 days', 'Set up of the software and the mobile app; configuration for your business; import of your data.', 'Software ready for testing'),
        ('2  Testing and improvement', '15 days', 'Your team uses the software on real work. We correct what is found and make improvements within the scope of this quotation.', 'Software accepted and live'),
        ('Total', '30 days', 'From the start date agreed with you.', ''),
    ], [34, 20, 78, 38], bold_first=True, total_last=True)
    h2('5.2', 'What we need from you')
    para('The timeline depends on the following being available when needed:')
    for t_ in ('Your item list, customer list and opening balances, in Excel or CSV.', 'A person from your team who can answer questions and approve the set-up during development.', 'Your team’s time for testing during the second fifteen days, and feedback in good time.'):
        p = d.add_paragraph(); p.paragraph_format.left_indent = Mm(6); p.paragraph_format.first_line_indent = Mm(-4); p.paragraph_format.space_after = Pt(3); run(p, '–  ' + t_, 10.5)

    # ───────── 6 hosting backup support ─────────
    h1('6', 'Hosting, backup and support')
    h2('6.1', 'Cloud hosting')
    para('The software is hosted on the cloud. Your users can work from the office, from home and from site, on a computer or on the Android app.')
    h2('6.2', 'Daily backup')
    para('A backup of your data is taken every day on the cloud and kept safely, so that your data can be restored if it is ever lost or damaged.')
    h2('6.3', 'Support')
    para('Our team supports your users during business hours. Problems with the software are corrected by us, and questions on how to do something are answered.')
    h2('6.4', 'Yearly renewal')
    para('The software is renewed every year at ₹25,000 per year, plus GST as applicable.')

    # ───────── 7 costing ─────────
    h1('7', 'Costing')
    h2('7.1', 'Price')
    t = new_table(8, [118, 52])
    for i, hdr in enumerate(('Item', 'Amount (₹)')):
        c = t.rows[0].cells[i]; cell_margins(c, 60, 60, 60, 60); cell_borders(c, bottom=(10, '0F1A2B')); p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, hdr.upper(), 8.3, True, MUTED)
        if i == 1: p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    names = ['Software development and set-up', 'Mobile app (Android)', 'Cloud hosting and daily backup', 'Support during business hours', 'Subtotal', 'GST', 'Total']
    for r_i, name in enumerate(names, start=1):
        tot = name in ('Subtotal', 'GST', 'Total'); last = name == 'Total'
        for i in (0, 1):
            c = t.rows[r_i].cells[i]; cell_margins(c, 120, 120, 60, 60); cell_borders(c, bottom=(10 if last else 4, '0F1A2B' if last else LINE), top=(10, '0F1A2B') if last else None)
            p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0)
            if i == 0: run(p, name, 10.5, tot, INK)
    para('', after=4)
    para('All amounts are in Indian rupees.', 9, False, MUTED, after=8)
    h2('7.2', 'Yearly renewal')
    ruled(['Item', 'Amount (₹)'], [('Yearly renewal of the software', '25,000 per year')], [118, 52], right=(1,))
    para('Plus GST as applicable.', 9, False, MUTED, after=8)
    pagebreak()

    # ───────── 8 terms ─────────
    h1('8', 'Commercial and general terms')
    ruled(['No.', 'Term', 'Detail'], [
        ('8.1', 'Payment terms', '______________________________________________'),
        ('8.2', 'Quotation valid until', '______________________________________________'),
        ('8.3', 'Proposed start date', '______________________________________________'),
        ('8.4', 'Scope', 'This quotation covers the features listed in section 3. Anything else is a change request.'),
        ('8.5', 'Change requests', 'Work outside the scope is quoted separately and started only after your written approval.'),
        ('8.6', 'Client responsibilities', 'The items listed in section 5.2 are provided on time. Delays on your side move the dates accordingly.'),
        ('8.7', 'Third-party charges', 'Charges of third-party services used with the software are payable by the client.'),
        ('8.8', 'Confidentiality', 'Each party keeps the other’s business information confidential. Your data stays yours.'),
        ('8.9', 'Taxes', 'GST is charged as applicable.'),
    ], [14, 42, 114])
    h1('9', 'Acceptance')
    para('By signing below, ' + CLIENT + ' accepts this quotation, including the scope in section 3, the delivery plan in section 5 and the costing in section 7.', after=18)
    t = new_table(1, [80, 10, 80])
    for col, (a, b_) in ((0, (SIGNER, 'For Rapid Rabbit Labs Private Limited')), (2, ('Name and designation', 'For ' + CLIENT))):
        c = t.rows[0].cells[col]; cell_borders(c, top=(10, '0F1A2B')); cell_margins(c, 120, 0, 0, 0)
        p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, a, 10.5, True, INK)
        q = c.add_paragraph(); q.paragraph_format.space_after = Pt(0); run(q, b_, 9.5, False, MUTED)
    para('', after=10)
    t = new_table(2, [80, 10, 80])
    for r_i, lbl in enumerate(('Signature', 'Date')):
        for col in (0, 2):
            c = t.rows[r_i].cells[col]; cell_borders(c, bottom=(4, LINE)); cell_margins(c, 160, 40, 0, 0); p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, lbl, 9, False, MUTED)

    out = HERE + '/Rapid-Rabbit-Labs-Quotation.docx'; d.save(out); return out

def pages_of(pdf):
    """Which page each numbered heading landed on, read from the rendered PDF (for the contents list)."""
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    found = {}
    keys = {'1': 'Executive summary', '2': 'Scope of work', '2.1': 'Objective', '2.2': 'Modules included', '2.3': 'Not included', '3': 'Solution description',
            '4': 'Deliverables', '5': 'Delivery plan and timeline', '6': 'Hosting, backup and support', '7': 'Costing', '8': 'Commercial and general terms', '9': 'Acceptance'}
    for i, m in enumerate(MODULES, start=1): keys[f'3.{i}'] = m[0]
    for pg in range(4, n + 1):  # the contents page itself is page 3
        txt = subprocess.run(['pdftotext', '-f', str(pg), '-l', str(pg), '-layout', pdf, '-'], capture_output=True, text=True).stdout
        for k, title in keys.items():
            if k.startswith('3.') and pg < found.get('3', 99): continue  # the scope table on an earlier page repeats these titles
            if k not in found and re.search(r'^\s*' + re.escape(k) + r'\.?\s+' + re.escape(title), txt, re.M): found[k] = pg
    return found

def convert(docx):
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', HERE, docx], capture_output=True)
    return HERE + '/Rapid-Rabbit-Labs-Quotation.pdf'

pages = {}
for _ in range(3):  # numbers in the contents move the layout slightly, so settle them
    pdf = convert(build(pages)); new = pages_of(pdf)
    if new == pages: break
    pages = new
print(json.dumps(pages)); print(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(0))
