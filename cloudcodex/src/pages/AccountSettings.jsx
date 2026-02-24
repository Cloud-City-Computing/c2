/**
 * Cloud Codex - Account Settings Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import StdLayout from '../page_layouts/Std_Layout';
import AccountMenu from '../components/AccountMenu';
import { clearInner, createAndAppend } from '../util';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';

/**
 * Loads the account menu into the left margin of the page.
 * It clears any existing content in the left margin and renders the AccountMenu component.
 * @returns { void }
 */
function loadPageMenu() {
  const leftMargin = document.getElementById( 'std-left' );
  if ( leftMargin ) {
    clearInner( leftMargin );
    const itemRoot = createRoot( createAndAppend( leftMargin, 'div', 'account-menu-container' ) );
    itemRoot.render( <AccountMenu /> );
  }
}

/**
 * Loads the Account Settings page, which includes the account menu in the left margin and a 
 * placeholder for account settings content.
 * @returns { JSX.Element } - The AccountSettings page component
 */
function AccountSettings() {
  useEffect(() => {
    loadPageMenu();
  }, []);
  return (
    <StdLayout>
    </StdLayout>
  );
}

export default AccountSettings;