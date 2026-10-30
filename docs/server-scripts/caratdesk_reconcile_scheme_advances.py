# Server Script
#   Script Type : API
#   API Method  : caratdesk_reconcile_scheme_advances
#   Allow Guest : No
#
# ERPNext only reconciles a Sales Invoice's Advances table on a NON-POS invoice. A POS bill
# (is_pos = 1) that redeems a Jewellery Scheme keeps the scheme's Payment Entry fully
# unallocated and the bill stays Partly Paid / Overdue for the scheme amount. POS Billing calls
# this right after submitting such a bill: it runs ERPNext's own Payment Reconciliation for each
# advance row not yet reconciled, so the books match a normal invoice (Advance Received From
# Customer -> Debtors against the bill, Payment Entry referenced and its unallocated reduced).
#
# Called with JSON body {"data": {"invoice": "SINV-..."}}. Safe to call again: rows already
# reconciled against this invoice are skipped.

data = frappe.form_dict.get("data")
if isinstance(data, str):
    data = json.loads(data)
data = data or {}

flt = frappe.utils.flt

si = frappe.get_doc("Sales Invoice", data.get("invoice"))
if si.docstatus != 1:
    frappe.throw("Sales Invoice " + str(si.name) + " is not submitted")

outstanding = flt(frappe.db.get_value("Sales Invoice", si.name, "outstanding_amount"), 2)
pr = frappe.get_doc("Payment Reconciliation")
pr.company = si.company
pr.party_type = "Customer"
pr.party = si.customer
pr.receivable_payable_account = si.debit_to
pr.default_advance_account = frappe.db.get_value("Company", si.company, "default_advance_received_account")
pr.set("invoices", [])
pr.set("payments", [])
pr.set("allocation", [])

reconciled = []
skipped = []
left = outstanding
for a in si.advances:
    if a.reference_type != "Payment Entry" or not a.reference_name:
        continue
    pe = a.reference_name
    if frappe.db.exists("Payment Entry Reference", {"parent": pe, "reference_doctype": "Sales Invoice", "reference_name": si.name, "docstatus": 1}):
        continue
    unallocated = flt(frappe.db.get_value("Payment Entry", {"name": pe, "docstatus": 1}, "unallocated_amount"), 2)
    amount = min(flt(a.allocated_amount, 2), unallocated, left)
    if amount <= 0:
        skipped.append(pe)
        continue
    pr.append("payments", {"reference_type": "Payment Entry", "reference_name": pe, "amount": unallocated,
        "is_advance": 1, "currency": si.currency, "exchange_rate": 1})
    pr.append("allocation", {"reference_type": "Payment Entry", "reference_name": pe,
        "invoice_type": "Sales Invoice", "invoice_number": si.name, "allocated_amount": amount,
        "amount": unallocated, "unreconciled_amount": unallocated, "is_advance": 1,
        "difference_amount": 0, "exchange_rate": 1, "currency": si.currency})
    left = flt(left - amount, 2)
    reconciled.append({"payment_entry": pe, "amount": amount})

if reconciled:
    pr.append("invoices", {"invoice_type": "Sales Invoice", "invoice_number": si.name, "invoice_date": si.posting_date,
        "amount": si.grand_total, "outstanding_amount": outstanding, "currency": si.currency, "exchange_rate": 1})
    pr.reconcile()

frappe.response["message"] = {
    "reconciled": reconciled,
    "skipped": skipped,
    "outstanding": flt(frappe.db.get_value("Sales Invoice", si.name, "outstanding_amount"), 2),
}
