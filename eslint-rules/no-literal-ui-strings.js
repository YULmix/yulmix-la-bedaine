// Structural i18n guard: flags any literal string that would render to the
// user (JSX text, or a value of a known user-facing prop) outside of
// src/locales/**. Deliberately not a language check (no French wordlist) —
// the invariant is "every UI string is a lookup", so the app stays
// localizable into any language without a future string hunt.
//
// Attribute checking is limited to a curated allowlist of props that are
// actually shown to users (placeholder, title, alt, aria-label, ...).
// Everything else (className, style, type, name, id, htmlFor, to, path,
// data-*, ...) is structural/code and is intentionally never checked —
// eslint-plugin-react's built-in jsx-no-literals can't make that
// distinction (it's all-attributes-or-none), which floods real signal with
// className noise on a Tailwind-heavy codebase.

const USER_FACING_ATTRIBUTES = new Set([
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'label'
]);

// Anything with no letters at all (punctuation, symbols, numbers, single
// glyphs like '—' or '/') is never user-facing text worth translating.
const hasLetters = (value) => /\p{L}/u.test(value);

const reportIfTranslatable = (context, node, value) => {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed || !hasLetters(trimmed)) return;
  context.report({
    node,
    messageId: 'literalUiString',
    data: { text: trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed }
  });
};

// Checks a JS expression that ends up rendered as JSX text or a user-facing
// attribute value for a hardcoded string literal anywhere within it — not
// just when the whole expression IS a literal. Recurses through `||`, `??`
// and ternary fallbacks (e.g. `data.name || 'Utilisateur inconnu'`,
// `isPaid ? 'Payé' : 'Non payé'`) since those are exactly where a fallback
// UI string tends to hide from a shallow "is this node a Literal" check.
// Deliberately does NOT recurse into function calls, member expressions, or
// other operand types — those are legitimately dynamic and out of scope.
const checkExprForLiterals = (context, node, expr) => {
  if (expr.type === 'Literal' && typeof expr.value === 'string') {
    reportIfTranslatable(context, node, expr.value);
  } else if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
    reportIfTranslatable(context, node, expr.quasis.map((q) => q.value.cooked).join(''));
  } else if (expr.type === 'LogicalExpression') {
    checkExprForLiterals(context, node, expr.left);
    checkExprForLiterals(context, node, expr.right);
  } else if (expr.type === 'ConditionalExpression') {
    checkExprForLiterals(context, node, expr.consequent);
    checkExprForLiterals(context, node, expr.alternate);
  }
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow literal user-facing strings outside src/locales/**'
    },
    schema: [],
    messages: {
      literalUiString: 'Literal UI string "{{text}}" must come from src/locales/fr.json (or src/lib/registrationOptions.js for raw DB value mappings), not a hardcoded literal.'
    }
  },
  create(context) {
    return {
      JSXText(node) {
        reportIfTranslatable(context, node, node.value);
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        const expr = node.expression;

        // Only care about expression containers that are themselves JSX
        // children (text) or the value of a user-facing attribute.
        const isJsxChild = parent.type === 'JSXElement' || parent.type === 'JSXFragment';
        const isUserFacingAttrValue = parent.type === 'JSXAttribute'
          && typeof parent.name?.name === 'string'
          && USER_FACING_ATTRIBUTES.has(parent.name.name);

        if (!isJsxChild && !isUserFacingAttrValue) return;

        checkExprForLiterals(context, node, expr);
      },
      JSXAttribute(node) {
        if (typeof node.name?.name !== 'string' || !USER_FACING_ATTRIBUTES.has(node.name.name)) return;
        if (node.value?.type === 'Literal' && typeof node.value.value === 'string') {
          reportIfTranslatable(context, node.value, node.value.value);
        } else if (node.value?.type === 'JSXExpressionContainer') {
          checkExprForLiterals(context, node.value, node.value.expression);
        }
      }
    };
  }
};
