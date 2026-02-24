import StdLayout from '../page_layouts/Std_Layout';
import AccountMenu from '../components/AccountMenu';
import { clearInner, standardRedirect, createAndAppend } from '../util';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';

function loadPageMenu() {
  // replace std-left margin panel with account settings menu
  const leftMargin = document.getElementById( 'std-left' );
  if ( leftMargin ) {
    clearInner( leftMargin );
    const itemRoot = createRoot( createAndAppend( leftMargin, 'div', 'account-menu-container' ) );
    itemRoot.render( <AccountMenu /> );
  }
}

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