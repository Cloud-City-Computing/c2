/**
 * Utility functions for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2025
 * https://cloudcitycomputing.com
 */

import { createRoot } from 'react-dom/client';

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