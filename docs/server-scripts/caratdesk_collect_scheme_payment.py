# Server Script
#   Script Type : API
#   API Method  : caratdesk_collect_scheme_payment
#   Allow Guest : No
#
# Collects one installment payment for a Jewellery Scheme Assignment in a single request:
# creates + submits one Payment Entry per payment mode, marks the selected rows Paid and
# matures the scheme when the last row is paid. Any error rolls the whole request back, so
# a Payment Entry can never be booked without its rows being marked Paid (or vice versa).
#
# Called from caratdesk-new-jewellery-scheme.html with JSON body {"data": {...}}:
#   assignment  : Jewellery Scheme Assignment name
#   company     : company name
#   rows        : installment row names being paid, in schedule order
#   emis        : {row name: EMI collected}  (the last row already carries any extra paid)
#   gold_rates  : {row name: gold rate}      (only for accumulate_gold schemes)
#   payments    : [{mode, amount, account, reference_no, reference_date}]
#   remarks     : Payment Entry remarks

data = frappe.form_dict.get("data")
if isinstance(data, str):
    data = json.loads(data)
data = data or {}

flt = frappe.utils.flt
CASH_LIMIT = 200000

asg = frappe.get_doc("Jewellery Scheme Assignment", data.get("assignment"))
if asg.docstatus != 1:
    frappe.throw("This assignment must be submitted before payments can be collected")
if (asg.status or "").strip().lower() != "active":
    frappe.throw("This assignment is " + (asg.status or "not active") + " — no further payments are allowed")

company = data.get("company")
receivable = frappe.db.get_value("Company", company, "default_receivable_account")
if not receivable:
    frappe.throw("Company has no default receivable account configured")

scheme = frappe.db.get_value("Jewellery Scheme", asg.scheme, ["accumulate_gold", "no_of_emi"], as_dict=True) or {}
accumulate_gold = bool(scheme.get("accumulate_gold"))
emi_count = int(scheme.get("no_of_emi") or 0)

details = sorted(asg.jewellery_scheme_assignment_details, key=lambda r: r.idx)
row_names = data.get("rows") or []
if not row_names:
    frappe.throw("Select at least one installment row")

# Rows must still be unpaid on the server — another counter may have collected them already
unpaid = [r for r in details if (r.status or "").lower() != "paid"]
by_name = {}
for r in details:
    by_name[r.name] = r
for n in row_names:
    r = by_name.get(n)
    if not r:
        frappe.throw("Installment row not found — refresh the page and try again")
    if (r.status or "").lower() == "paid":
        frappe.throw("Installment " + str(r.idx) + " is already paid — refresh the page")

# Installments are paid in schedule order: the selection must be the earliest unpaid rows
expected = [r.name for r in unpaid[:len(row_names)]]
if sorted(expected) != sorted(row_names):
    frappe.throw("Select installments in sequence, starting from the earliest unpaid row")

emis = data.get("emis") or {}
gold_rates = data.get("gold_rates") or {}
min_emi = flt(asg.emi_amount)
total_due = 0
for n in row_names:
    emi = flt(emis.get(n) or by_name[n].emi)
    if emi < min_emi:
        frappe.throw("Installment " + str(by_name[n].idx) + ": EMI cannot be less than the EMI Amount " + str(min_emi))
    if accumulate_gold and not flt(gold_rates.get(n)) > 0:
        frappe.throw("Enter Gold Rate for this gold accumulation scheme")
    total_due = total_due + emi

# Plain loops, not comprehensions: Server Script locals (flt) aren't visible inside them
payments = []
for p in (data.get("payments") or []):
    if flt(p.get("amount")) > 0:
        payments.append(p)
if not payments:
    frappe.throw("Enter at least one payment amount")
paid_total = 0
cash_total = 0
for p in payments:
    paid_total = paid_total + flt(p.get("amount"))
    if frappe.db.get_value("Mode of Payment", p.get("mode"), "type") == "Cash":
        cash_total = cash_total + flt(p.get("amount"))
if abs(flt(paid_total, 2) - flt(total_due, 2)) > 0.01:
    frappe.throw("Payment total " + str(flt(paid_total, 2)) + " must equal the EMI total " + str(flt(total_due, 2)))
if cash_total > CASH_LIMIT:
    frappe.throw("Cash payment cannot exceed " + str(CASH_LIMIT) + " per transaction")

posting_date = frappe.utils.nowdate()
pe_names = []
for p in payments:
    mode = p.get("mode")
    account = frappe.db.get_value("Mode of Payment Account", {"parent": mode, "company": company}, "default_account") or p.get("account")
    acc = frappe.db.get_value("Account", account, ["account_type", "company", "is_group"], as_dict=True) if account else None
    if not acc or acc.company != company or acc.is_group or acc.account_type not in ("Cash", "Bank"):
        frappe.throw("No Cash/Bank account found for mode " + str(mode))
    amount = flt(p.get("amount"), 2)
    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Receive"
    pe.party_type = "Customer"
    pe.party = asg.customer
    pe.company = company
    pe.posting_date = posting_date
    pe.mode_of_payment = mode
    pe.paid_from = receivable
    pe.paid_to = account
    pe.paid_amount = amount
    pe.received_amount = amount
    pe.source_exchange_rate = 1
    pe.target_exchange_rate = 1
    pe.reference_no = (p.get("reference_no") or "").strip() or None
    pe.reference_date = p.get("reference_date") or (None if frappe.db.get_value("Mode of Payment", mode, "type") == "Cash" else posting_date)
    # custom_remarks stops ERPNext replacing our remarks with "Amount INR … received from …"
    pe.custom_remarks = 1
    pe.remarks = data.get("remarks")
    pe.custom_scheme_assignment = asg.name
    pe.insert()
    pe.submit()
    pe_names.append(pe.name)

for n in row_names:
    r = by_name[n]
    r.status = "Paid"
    r.payment_entry = pe_names[0]
    r.paid_by = r.paid_by or "Customer"
    r.payment_date = r.payment_date or posting_date
    r.emi = flt(emis.get(n) or r.emi)
    if accumulate_gold:
        rate = flt(gold_rates.get(n))
        r.gold_rate = rate
        r.gold_qty = flt(r.emi / rate, 3)

all_paid = len(details) > 0 and len(details) >= emi_count and all((r.status or "").lower() == "paid" for r in details)
if all_paid and accumulate_gold:
    # Final rate = rate on the last installment paid in this payment
    final_rate = flt(by_name[row_names[-1]].gold_rate)
    if final_rate > 0:
        for r in details:
            if flt(r.gold_rate) > 0:
                r.diffrence_rate = flt(final_rate - flt(r.gold_rate), 2)
                r.amount = flt(r.diffrence_rate * flt(r.gold_qty), 2)
if all_paid:
    asg.status = "Matured"

# Lets the Jewellery Scheme Assignment validation script accept the newly Paid rows
asg.flags.caratdesk_collect = True
asg.save()

frappe.response["message"] = {"payment_entries": pe_names, "matured": all_paid}
