# Server Script — create TWO scripts with this same code:
#   1) Script Type : DocType Event   Reference Document Type : Jewellery Scheme Assignment
#      DocType Event : Before Validate                      (draft save + submit)
#   2) Script Type : DocType Event   Reference Document Type : Jewellery Scheme Assignment
#      DocType Event : Before Save (Submitted Document)     (every edit after submit)
#
# Enforces the scheme rules on the server, so editing from Desk or the REST API can't
# bypass the Jewellery Scheme page:
#   - an installment can only turn Paid through caratdesk_collect_scheme_payment
#   - a Paid installment can't be removed, un-paid, or have its amount/payment changed
#   - a Paid installment must link a submitted Payment Entry of this customer
#   - status can only become Matured when every row is Paid and the schedule has at
#     least the scheme's No. of EMI rows

flt = frappe.utils.flt
LOCKED_NUMBERS = ["emi", "gold_rate", "gold_qty"]
LOCKED_TEXT = ["payment_entry", "payment_date", "date", "original_due_date"]

def is_paid(row):
    return (row.status or "").strip().lower() == "paid"

# A draft never holds payments (the payment API needs a submitted assignment). New rows also
# get the status Select's first option, "Paid", when none is given — reset them to Unpaid.
if doc.docstatus == 0:
    for r in doc.jewellery_scheme_assignment_details:
        if is_paid(r):
            r.status = "Unpaid"

before = doc.get_doc_before_save()
old_rows = {}
if before:
    for o in before.jewellery_scheme_assignment_details:
        old_rows[o.name] = o

rows = doc.jewellery_scheme_assignment_details
current_names = [r.name for r in rows]
for name in old_rows:
    o = old_rows[name]
    if is_paid(o) and name not in current_names:
        frappe.throw("Paid installment " + str(o.idx) + " cannot be removed")

for r in rows:
    o = old_rows.get(r.name) if r.name else None
    if o and is_paid(o):
        # caratdesk_reverse_scheme_payment un-pays the last payment's rows after cancelling its Payment Entries
        if doc.flags.get("caratdesk_reverse"):
            continue
        if not is_paid(r):
            frappe.throw("Installment " + str(r.idx) + " is already paid and cannot be changed back")
        for f in LOCKED_NUMBERS:
            if flt(o.get(f), 3) != flt(r.get(f), 3):
                frappe.throw("Installment " + str(r.idx) + " is already paid — " + f + " cannot be changed")
        for f in LOCKED_TEXT:
            if str(o.get(f) or "") != str(r.get(f) or ""):
                frappe.throw("Installment " + str(r.idx) + " is already paid — " + f + " cannot be changed")
    elif is_paid(r):
        if not doc.flags.get("caratdesk_collect"):
            frappe.throw("Installment " + str(r.idx) + " can only be marked Paid by collecting the payment on the Jewellery Scheme page")
        pe = frappe.db.get_value("Payment Entry", r.payment_entry, ["docstatus", "party"], as_dict=True) if r.payment_entry else None
        if not pe or pe.docstatus != 1 or pe.party != doc.customer:
            frappe.throw("Installment " + str(r.idx) + " must link a submitted Payment Entry of customer " + str(doc.customer))

now_matured = (doc.status or "").strip().lower() == "matured"
was_matured = bool(before) and (before.status or "").strip().lower() == "matured"
if now_matured and not was_matured:
    emi_count = int(frappe.db.get_value("Jewellery Scheme", doc.scheme, "no_of_emi") or 0)
    # Plain loop, not all(...): Server Script locals (is_paid) aren't visible inside a generator
    unpaid_count = 0
    for r in rows:
        if not is_paid(r):
            unpaid_count = unpaid_count + 1
    if not rows or len(rows) < emi_count or unpaid_count:
        frappe.throw("The scheme can only mature once all " + str(max(emi_count, len(rows))) + " installments are paid")
