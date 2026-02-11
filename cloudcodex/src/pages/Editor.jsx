/**
 * Cloud Codex - Editor Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import JoditEditor from 'jodit-react';
import { serverReq, standardRedirect } from '../util';

/**
 * Creates a WYSIWYG editor component using Jodit Editor.
 * @param { String } content - The current content of the editor 
 * @param { Function } setContent - A function to update the content state when the editor loses focus
 * @returns { JSX.Element } - The Jodit Editor component
 */
function EditorComponent({ content, setContent }) {
  const editor = useRef(null);
  const config = useMemo(
    () => ({
      readonly: false,
      placeholder: 'Start typing...',
      style: {
        color: '#000'
      },
      toolbarButtonSize: 'large'
    }),
    []
  );
  return (
    <JoditEditor
      key={content}
      ref={editor}
      value={content}
      config={config}
      onBlur={setContent}
    />
  );
}

/**
 * Saves document content to the server when the save button is clicked.
 * @returns { Function } - The function to be called on save button click
 */
function saveDocument() {
  const urlParams = new URLSearchParams(window.location.search);
  return async function() {
    const editorContent = document.querySelector('.jodit-wysiwyg').innerHTML;
    const response = await serverReq('POST', '/api/save-document', {
      doc_id: Number(urlParams.get('doc_id')),
      html_content: editorContent
    });
    if (response.success) {
      alert('Document saved successfully!');
      standardRedirect('/');
    }
    else {
      alert('Error saving document: ' + response.message);
    }
  }
}

/**
 * Fetches a document from the server by its ID.
 * @param { Integer } doc_id - The ID of the document to fetch
 * @returns { JSON } - The document data returned from the server
 */
async function fetchDocument( doc_id ) {
  const response = await serverReq( 'GET', '/api/document?doc_id=' + encodeURIComponent( doc_id ) );
  return response ?? { document: null };
}

/**
 * Generates the editor page.
 * @returns { JSX.Element } - The Editor component
 */
export default function Editor() {
  const urlParams = new URLSearchParams(window.location.search);
  const doc_id = urlParams.get('doc_id');

  const [content, setContent] = useState('');
  const [documentData, setDocumentData] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      if (doc_id) {
        const data = await fetchDocument(doc_id);
        setDocumentData(data?.document || null);
        setContent(data?.document.html_content || '');
      }
    };
    loadData();
  }, [doc_id]);

  return (
    <StdLayout>
      <div className="editor-header">
        <h2>{documentData ? documentData.title : 'Loading Document...'}</h2>
      </div>
      <div className="editor-container">
        <EditorComponent content={content} setContent={setContent} />
      </div>
      <div className="editor-footer">
        <button className="c2-btn save-button" onClick={ saveDocument() }>Save Document</button>
      </div>
    </StdLayout>
  );
}