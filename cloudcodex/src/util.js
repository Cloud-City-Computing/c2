/**
 * Utility functions for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createRoot } from 'react-dom/client';

export async function serverReq( reqType, url, data ) {
  return await fetch( url, {
    method: reqType,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify( data )
  } )
  .then( response => response.json() )
  .catch( error => {
    console.error( `Error during ${ reqType } request to ${ url }:`, error );
    throw error;
  } );
}

/**
 * Function to clear all child elements of a given HTMLElement
 * @param { HTMLElement } element - The element to clear
 * @returns { void }
 */
export function clearInner( element ) {
  while ( element.firstChild ) {
    element.removeChild( element.firstChild );
  }
}

/**
 * Returns the HTMLElement with the given id
 * @param { String } id - The id of the element
 * @returns { HTMLElement | null } - The element with the given id, or null if not found
 */
export function GetElById( id ) {
  return document.getElementById( id );
}

/**
 * Gets the value of an input element by id
 * @param { String } id - The id of the input element
 * @returns { Any } - The value of the input element, or null if not found
 */
export function GetVal( id ) {
  const el = GetElById( id );
  if ( el ) {
    return el.value;
  }
  return null;
}

/**
 * Sets the value of an input element by id
 * @param { String } id - The id of the input element
 * @param { Any } value - The value to set
 */
export function SetVal( id, value ) {
  const el = GetElById( id );
  if ( el ) {
    el.value = value;
  }
}

/**
 * Function to create a new HTMLElement and append it to a parent
 * @param { HTMLElement } parent - The parent element to append to
 * @param { String } tag - The tag name of the element to create
 * @param { String } className - Optional class name to assign
 * @returns { HTMLElement } - The newly created element
 */
export function createAndAppend( parent, tag, className ) {
  const element = document.createElement( tag );
  if ( className ) {
    element.className = className;
  }
  parent.appendChild( element );
  return element;
}

/**
 * Function to hide the modal dimmer
 * @returns { void }
 */
export function hideModalDimmer() {
  const modalDimmer = window.document.getElementById( 'modal-dimmer' );
  if ( modalDimmer ) {
    modalDimmer.style.display = 'none';
  }
}

/**
 * Function to destroy the modal and hide the dimmer
 * @returns { void }
 */
export function destroyModal() {
  const modalRoot = window.document.getElementById( 'modal-root' );
  hideModalDimmer();
  clearInner( modalRoot );
}

/**
 * Function to show the modal dimmer and set up click to close
 * @returns { void }
 */
export function showModalDimmer() {
  const modalDimmer = window.document.getElementById( 'modal-dimmer' );
  if ( modalDimmer ) {
    modalDimmer.style.display = 'block';
    modalDimmer.onclick = () => {
      destroyModal();
      modalDimmer.style.display = 'none';
    };
  }
}

/**
 * Redirects the browser to the specified URL
 * @param { String } url - The URL to redirect to
 * @returns { void }
 */
export function standardRedirect( url ) {
  window.location.href = url;
}

/**
 * Creates and displays a modal with the given content
 * @param { JSX.Element } content - The content to display in the modal
 * @returns { void }
 */
export function showModal( content ) {
  const modalRoot = window.document.getElementById( 'modal-root' );
  clearInner( modalRoot );
  if ( modalRoot ) {
    const modalContentRoot = createRoot( createAndAppend( modalRoot, 'div', 'modal-content-wrapper' ) );
    showModalDimmer();
    modalContentRoot.render( content );
    const modalDimmer = window.document.getElementById( 'modal-dimmer' );
    if ( modalDimmer ) {
      modalDimmer.onclick = () => {
        destroyModal();
        modalDimmer.style.display = 'none';
      };
    }
  }
}

/**
 * Gets the session token from the browser cookies
 * @returns { String | null } - The session token if found, or null if not found
 */
export function getSessionTokenFromCookie() {
  const sessionToken = document.cookie
    .split('; ')
    .find(row => row.startsWith('sessionToken='))
    ?.split('=')[1];
  if ( !sessionToken ) {
    removeSessStorage( 'currentUser' );
  }
  return sessionToken ?? null;
}

/**
 * Sets a value in session storage with a "c2-" prefix to avoid key collisions
 * @param { String } key - The key to store the value under (without prefix)
 * @param { Any } value - The value to store (will be converted to string)
 */
export function setSessStorage( key, value ) {
  if ( value === null ) {
    sessionStorage.setItem( "c2-" + key, "null" );
  }
  else {
    sessionStorage.setItem( "c2-" + key, value.toString() );
  }
}

/**
 * Gets a value from session storage using a "c2-" prefix to avoid key collisions
 * @param { String } key - The key to retrieve the value for (without prefix)
 * @returns { Any | null } - The value from session storage, or null if not found
 */
export function getSessStorage( key ) {
  const value = sessionStorage.getItem( "c2-" + key );
  if ( value === "null" ) {
    return null;
  }
  if ( JSON.parse( value ) ) {
    return JSON.parse( value );
  }
  return value;
}

/**
 * Removes a value from session storage using a "c2-" prefix to avoid key collisions
 * @param { String } key - The key to remove (without prefix)
 * @returns { void }
 */
export function removeSessStorage( key ) {
  if ( getSessStorage( key ) ) {
    sessionStorage.removeItem( "c2-" + key );
  }
}

/**
 * Performs an auto-login attempt by validating the session token from cookies and retrieving user details.
 * If the session token is valid, it stores the user details in session storage and returns true.
 * If the session token is invalid or an error occurs, it returns false.
 * @param { String } sessionToken - The session token to validate
 * @returns { Promise<Boolean> } - Resolves to true if auto-login is successful, false otherwise
 */
export async function attemptAutoLogin( sessionToken ) {
  let loggedIn = false;
  if ( !getSessStorage( 'currentUser' ) && sessionToken ) {
    const response = await serverReq( 'POST', '/api/validate-session', { token: sessionToken } );
    if ( response.valid ) {
      loggedIn = true;
      setSessStorage( 'currentUser', JSON.stringify( response.user ) );
    }
    else {
      console.log( 'Session token invalid or expired.' );
    }
  }
  return loggedIn;
}