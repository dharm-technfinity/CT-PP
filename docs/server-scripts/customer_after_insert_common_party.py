# Server Script
#   Script Type             : DocType Event
#   Reference Document Type : Customer
#   DocType Event           : After Insert
#
# Common Party: every new Customer (POS, Desk or REST API) gets a Supplier with the same
# name, joined by a Party Link with Customer as primary and Supplier as secondary.
#   - an existing Supplier with the same name is reused when its GSTIN matches the
#     Customer's (both blank counts as a match) and it isn't already in any Party Link
#   - otherwise a new Supplier is created (Supplier Group from Buying Settings); if the
#     name is taken under "Supplier Name" naming it gets a " - 1", " - 2"... suffix
# Runs in the Customer's transaction, so a failure here rolls the Customer back too.

def norm_gstin(value):
    return (value or "").strip().upper()

def in_party_link(supplier):
    return frappe.db.exists("Party Link", {"primary_role": "Supplier", "primary_party": supplier}) or \
        frappe.db.exists("Party Link", {"secondary_role": "Supplier", "secondary_party": supplier})

already_linked = frappe.db.exists("Party Link", {"primary_role": "Customer", "primary_party": doc.name}) or \
    frappe.db.exists("Party Link", {"secondary_role": "Customer", "secondary_party": doc.name})

if not already_linked:
    customer_gstin = norm_gstin(doc.get("gstin"))
    supplier = None

    for row in frappe.get_all("Supplier", filters={"supplier_name": doc.customer_name},
            fields=["name", "gstin"], order_by="creation asc"):
        if norm_gstin(row.gstin) == customer_gstin and not in_party_link(row.name):
            supplier = row.name
            break

    if not supplier:
        new_supplier = frappe.get_doc({
            "doctype": "Supplier",
            "supplier_name": doc.customer_name,
            "supplier_type": doc.customer_type or "Individual",
            "supplier_group": frappe.db.get_single_value("Buying Settings", "supplier_group"),
            "gstin": doc.get("gstin") or "",
            "gst_category": doc.get("gst_category") or "Unregistered",
            "pan": doc.get("pan") or "",
        })
        set_name = None
        if frappe.db.get_single_value("Buying Settings", "supp_master_name") == "Supplier Name" \
                and frappe.db.exists("Supplier", doc.customer_name):
            n = 1
            while frappe.db.exists("Supplier", doc.customer_name + " - " + str(n)):
                n += 1
            set_name = doc.customer_name + " - " + str(n)
        new_supplier.insert(ignore_permissions=True, set_name=set_name)
        supplier = new_supplier.name

    frappe.get_doc({
        "doctype": "Party Link",
        "primary_role": "Customer",
        "primary_party": doc.name,
        "secondary_role": "Supplier",
        "secondary_party": supplier,
    }).insert(ignore_permissions=True)
