# Writing Test Steps

This guide shows you how to write Act and Assert step descriptions that
Catcher can execute reliably. Catcher reads your description and uses
an LLM + Playwright to actually drive the browser, so the wording matters.

---

## The golden rule: use quotes for any literal text

Wrap exact element text or expected content in **single or double quotes**.
Catcher extracts quoted strings as priority match targets.

✅ **Good**
- `Click the 'Add address' button`
- `Type '123 Main St' in the address textbox`
- `Verify the page contains 'Order placed successfully'`
- `Verify the 'Sign in' button is not visible`

❌ **Avoid**
- `Click save` — too ambiguous, may match "Save", "Save Draft", "Save & Continue"
- `Verify success message` — what's the exact message? LLM has to guess
- `Click Add address button` — works sometimes but quoted is more reliable

When you quote a string, Catcher runs a **deterministic substring search**
for asserts (no LLM hallucination possible) and gives the planner a high-
confidence text match for actions.

---

## Writing Act steps

Act steps perform an action. The pattern is **verb + element + (value)**.

### Click / tap / press

```
Click the 'Add to cart' button
Click the 'Forgot password?' link
Click the close button       ← icon-only buttons work too
Tap the menu icon
Press Escape                  ← keyboard input
```

### Typing / filling

Always quote what you want typed:

```
Type 'hello world' in the search box
Fill the email field with 'test@example.com'
Type '4242 4242 4242 4242' in the card number field
```

### Selecting from a dropdown

```
Select 'United States' from the country dropdown
Choose 'Express shipping' option
```

### Navigation

```
Open the contact page
Navigate to the pricing section
Go to the cart
```

### Hover / check / uncheck

```
Hover over the user avatar
Check the 'I agree to terms' checkbox
Uncheck the newsletter checkbox
```

### When the element has no obvious name

For icon-only buttons (X, hamburger, etc.) or styled `<div>` "buttons":

```
Click the close button                    ← matches class~="close" / icon=close.svg
Click the hamburger menu                  ← matches class~="menu|hamburger"
Click the dark area outside the panel    ← matches class~="modal-mask|overlay|backdrop"
Select a taste tag from the available options    ← matches by category
```

Catcher's planner has heuristics for these common patterns. If your page
uses unusual class names and the LLM can't find the target, you'll see a
clear "no element with text 'X' found" failure rather than a wrong click.

### Closing modals / overlays

If your test left a modal open and the next step needs to interact with
something behind it, Catcher usually handles this automatically (it
detects the overlay and dismisses it before the action). But if you want
to be explicit:

```
Press Escape to close the modal
Click the close button
Click the dark area outside the modal
```

---

## Writing Assert steps

Assert steps verify something is (or isn't) true. The pattern is
**(thing) + verb + (expected condition)**.

### Substring presence (most reliable — quoted!)

```
Verify the page contains 'Order #12345'
Verify the textbox contains 'vegan friendly sandwiches'
Verify the heading shows 'Welcome back'
The page displays 'Total: $50.00'
```

These trigger Catcher's deterministic check — no LLM judgment needed.
They're nearly impossible to get wrong if the text is on the page.

### Substring absence (also deterministic when quoted!)

```
Verify the 'Sign in' button is not visible
The error message 'Invalid email' should not be present
'Add to cart' button should not exist after the item is added
```

The keywords `not / never / missing / absent / hidden / removed / gone /
disappeared / no longer` trigger the negative check.

### Element existence / visibility

```
Verify the address input field is visible
Verify the cart icon is shown in the header
The login form is displayed
```

### URL / navigation

```
Verify the URL is 'https://bytey.ai'
The current page is the cart page
URL should end with '/checkout'
```

### State / count / structure (semantic — uses the LLM)

```
Verify there are 3 items in the cart
Verify the submit button is disabled
The price field shows a valid currency amount
```

These need the LLM to interpret meaning. Less deterministic but still works.
Add quoted strings if you can to anchor the judgment.

---

## Tips for writing good descriptions

### 1. Be specific about which element

If multiple things on the page could match, narrow it down:

✅ `Click the 'Save' button in the address form`
❌ `Click 'Save'` — there might be Save in the address modal AND a Save Draft elsewhere

Catcher disambiguates same-text elements automatically when possible
(`text` field on selectors), but giving context helps.

### 2. One action per step

Break multi-step actions into separate Acts:

✅
```
Click the 'Add address' button
Type '123 Main St' in the address textbox
Click the 'Confirm' button
```

❌ `Add address '123 Main St' and confirm` — three actions in one,
   harder for the planner to translate.

### 3. Mention prerequisites only if necessary

Catcher automatically dismisses blocking overlays before clicking
something behind them, and it inserts settle waits between steps. You
usually don't need to write `wait 1 second` or `close the modal first`.

But if a specific step needs a longer wait (e.g., a slow API call):

```
Wait for 2 seconds
Verify the order confirmation appears
```

### 4. Use natural language for category targets

When you don't know the exact label (e.g. selecting "any" item):

✅ `Select a taste tag from the available options`
✅ `Click the first product card`
✅ `Pick any available time slot`

Catcher's planner falls back to category-based matching (class names,
roles) when no quoted text is provided.

### 5. For asserts, quote whatever the user would actually see

If the page renders "Total: $50.00" and you want to assert it, write:

✅ `Verify the page shows 'Total: $50.00'` — exact text on page
❌ `Verify the total is 50 dollars` — semantic, more brittle

---

## Reference: keywords Catcher recognizes

### Action verbs (Act steps)
`click, tap, press, select, choose, type, fill, enter, hover, check, uncheck,
open, navigate, go to`

### Positive assertion verbs (Assert steps — trigger deterministic check)
`contain, contains, has, have, show, shows, display, displays, include,
includes, present, visible, equal, equals, reads, says, exist, exists, is, are`

### Negative markers (with quoted text → deterministic absence check)
`not, never, missing, absent, hidden, removed, gone, disappeared, no longer`

### Keyboard keys
`Enter, Escape, Tab, ArrowUp, ArrowDown, Backspace, Space, ...` (any
Playwright-supported key name)

---

## Examples: full mini-tests

### Login flow
```
Type 'alice@example.com' in the email field
Type 'hunter2' in the password field
Click the 'Sign in' button
Verify the URL contains '/dashboard'
Verify the page shows 'Welcome, Alice'
```

### Add to cart
```
Click the first product card
Click the 'Add to cart' button
Verify the cart badge shows '1'
Click the cart icon
Verify the cart contains the product name
```

### Form validation
```
Click the 'Submit' button
Verify the page shows 'Email is required'
Type 'not-an-email' in the email field
Click the 'Submit' button
Verify the page shows 'Invalid email format'
```

### Modal interaction
```
Click the 'Settings' button
Verify the settings modal is visible
Click the 'Save changes' button
Verify the settings modal is not visible
Verify the page shows 'Settings saved'
```

---

## When tests fail unexpectedly

1. **"no element with text 'X' found"** — the LLM couldn't find your target.
   Try quoting the exact visible text, or describe the element's role/position
   ("the close button at top-right of the modal").

2. **Action passed but the assertion fails** — the page may not have updated
   yet. Catcher waits ~500ms + network idle between steps; if your app
   takes longer, add a `Wait for 2 seconds` step before the assert.

3. **"intercepts pointer events"** — something is covering your target.
   Catcher auto-retries at the element corner. If still failing, the
   blocking element might be a modal — add a step to close it first.

4. **Wrong element clicked** — your description was ambiguous. Quote the
   exact text, or add disambiguating context ("the Save button in the
   address modal" not just "Save").

For everything else: open the run drawer to see the live browser preview
and per-step reasoning — it usually reveals what the LLM saw and why it
chose what it did.
