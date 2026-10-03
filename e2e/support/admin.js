// The admin navigation (#208, ADR 0022): a sidebar from md up, a bottom bar plus « Plus » on
// phones. Both are a nav with the same label; only one is shown at a time.
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../../src/locales/fr.json', import.meta.url), 'utf-8'));

export const adminNav = page => page.getByRole('navigation', { name: fr.adminTabsAriaLabel });

/** The current admin page: the section or view, under its header. */
export const adminMain = page => page.getByRole('main');

/** A section's entry in the shown nav: the sidebar, or the phone bar (not what's under « Plus »). */
export const sectionLink = (page, name) => adminNav(page).getByRole('link', { name });

/** A view's entry in the sidebar (from md up; phones have ViewTabs). */
export const viewLink = (page, name) => adminNav(page).getByRole('link', { name });

export const moreButton = page => adminNav(page).getByRole('button', { name: fr.adminMore });
export const moreSheet = page => page.getByRole('dialog', { name: fr.adminMore });

/** Goes to a section the way a person would: its link, or on a phone through « Plus ». */
export async function openSection(page, name) {
  const link = sectionLink(page, name);
  if (await link.isVisible()) {
    await link.click();
  } else {
    await moreButton(page).click();
    await moreSheet(page).getByRole('link', { name }).click();
    await expect(moreSheet(page)).toHaveCount(0);
  }
}

/** The back link a detail page opens with (#210): « ← Événements », « ← Sites », « ← {venue} ». */
export const backLink = (page, parentName) => page.getByRole('link', { name: fr.adminBackTo.replace('{name}', parentName) });

/** An event's row in the Événements list: events other than the active one have actions too (#111), so « Modifier » is looked for in a row. */
export const eventRow = (page, theme) => adminMain(page).getByRole('listitem').filter({ has: page.getByText(theme, { exact: true }) });
