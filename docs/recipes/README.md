# Recipes

End-to-end checklists for the changes teams actually make to this app. Each one names every file, in the order to touch them, and says which step people forget.

They are written to be handed to Claude Code: open a session in the repo and say _"follow docs/recipes/add-asset-field.md to add a `mac_address` field"_. They read as instructions to a person too.

| Recipe                                               | When                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [add-asset-field.md](add-asset-field.md)             | A column every asset should have, on the form, the table, the CSV and the export.    |
| [add-enum-value.md](add-enum-value.md)               | A new category, condition or any other enum value. (Statuses are edited in the app.) |
| [add-permission-action.md](add-permission-action.md) | A new thing a role may be granted. (Roles themselves are edited in the app.)         |
| [add-page.md](add-page.md)                           | A new section with its own nav entry and route.                                      |
| [add-dashboard-widget.md](add-dashboard-widget.md)   | Another card on the dashboard, toggleable per member.                                |
| [add-email.md](add-email.md)                         | A new message, transactional or scheduled.                                           |
| [rebrand.md](rebrand.md)                             | Your own name, colours and fonts.                                                    |
| [change-infrastructure.md](change-infrastructure.md) | Resize, re-region, rotate or restore the AWS deployment in `infrastructure/`.        |

## Before any of them

Two things hold across every recipe:

- **Write the failing test first.** Not a ritual: the repo's tests are how you find the six places a field has to appear, because five of them already have one.
- **Domain vocabulary starts in `packages/shared`.** If a change means a new word — a status, a label, a permission — it begins there and ripples outward. Starting anywhere else means two places will disagree.

[`change-infrastructure.md`](change-infrastructure.md) is the exception to both, and says so: Terraform is configuration, there is no failing test to write, and the guard rail is the plan you read before you apply.

Read [`/CLAUDE.md`](../../CLAUDE.md) once, and the `CLAUDE.md` next to whatever you are editing every time.
