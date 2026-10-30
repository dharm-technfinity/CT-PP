# Server Script
#   Script Type : API
#   API Method  : caratdesk_reverse_scheme_payment
#   Allow Guest : No
#
# Reverses the MOST RECENT payment on a Jewellery Scheme Assignment in a single request:
# cancels every Payment Entry of that payment (a Cash + UPI split makes several), sets its
# rows back to Unpaid and a Matured scheme back to Active. Any error rolls everything back.
#
# The last payment's Payment Entries are the one linked on the last Paid row plus any later
# Payment Entry linked to this assignment (custom_scheme_assignment) — payments are always
# collected in schedule order, so nothing newer can belong to an earlier payment.
#
# Called from caratdesk-new-jewellery-scheme.html with JSON body {"data": {"assignment": ...}}

data = frappe.form_dict.get("data")
if isinstance(data, str):
    data = json.loads(data)
data = data or {}

flt = frappe.utils.flt

asg = frappe.get_doc("Jewellery Scheme Assignment", data.get("assignment"))
if asg.docstatus != 1:
    frappe.throw("Only a submitted assignment has payments to reverse")
if asg.get("used"):
    frappe.throw("This scheme has already been redeemed in POS Billing — its payments can't be reversed")
if (asg.status or "").strip().lower() not in ("active", "matured"):
    frappe.throw("This assignment is " + str(asg.status) + " — its payments can't be reversed")

details = sorted(asg.jewellery_scheme_assignment_details, key=lambda r: r.idx)
paid = []
for r in details:
    if (r.status or "").strip().lower() == "paid":
        paid.append(r)
if not paid:
    frappe.throw("There is no paid installment to reverse")

first_pe = paid[-1].payment_entry
if not first_pe:
    frappe.throw("The last paid installment has no Payment Entry linked")
group_rows = []
for r in paid:
    if r.payment_entry == first_pe:
        group_rows.append(r)

first_creation = frappe.db.get_value("Payment Entry", first_pe, "creation")
pe_names = frappe.get_all("Payment Entry", filters={
    "custom_scheme_assignment": asg.name, "docstatus": 1, "creation": [">=", first_creation],
}, pluck="name")
if first_pe not in pe_names and frappe.db.get_value("Payment Entry", first_pe, "docstatus") == 1:
    pe_names.append(first_pe)

pes = []
for name in pe_names:
    pe = frappe.get_doc("Payment Entry", name)
    if flt(pe.unallocated_amount, 2) < flt(pe.paid_amount, 2):
        frappe.throw("Payment Entry " + name + " is already adjusted against a bill — it can't be reversed")
    pes.append(pe)

# Rows are un-paid first: ERPNext won't cancel a Payment Entry the submitted assignment still links to
for r in group_rows:
    r.status = "Unpaid"
    r.payment_entry = None
    r.payment_date = None
    r.paid_by = None
    r.emi = flt(asg.emi_amount)
    r.gold_rate = 0
    r.gold_qty = 0
if (asg.status or "").strip().lower() == "matured":
    asg.status = "Active"
    # Gold gain is worked out again when the scheme matures next time
    for r in details:
        r.diffrence_rate = 0
        r.amount = 0

# Lets the Jewellery Scheme Assignment validation script accept the un-paid rows
asg.flags.caratdesk_reverse = True
asg.save()

for pe in pes:
    # Lets the Payment Entry Before Cancel script allow this cancellation
    pe.flags.caratdesk_reverse = True
    pe.flags.ignore_permissions = True
    pe.cancel()

rows_text = []
for r in group_rows:
    rows_text.append(str(r.idx))
frappe.response["message"] = {"cancelled": pe_names, "rows": rows_text}
