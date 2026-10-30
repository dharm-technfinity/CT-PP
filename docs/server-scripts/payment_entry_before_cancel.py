# Server Script
#   Script Type             : DocType Event
#   Reference Document Type : Payment Entry
#   DocType Event           : Before Cancel
#
# A scheme installment's Payment Entry can only be cancelled through Reverse Last Payment on
# the Jewellery Scheme page (caratdesk_reverse_scheme_payment), which also sets the rows back
# to Unpaid. Cancelling it directly would reverse the money but leave the rows Paid.

if not doc.flags.get("caratdesk_reverse"):
    assignment = doc.get("custom_scheme_assignment") or frappe.db.get_value(
        "Jewellery Scheme Assignment Details", {"payment_entry": doc.name}, "parent")
    if assignment:
        frappe.throw("This payment belongs to scheme " + str(assignment)
            + " — use Reverse Last Payment on the Jewellery Scheme page instead of cancelling it here")
