/**
 * Cloud Codex - the not-found page (W6-CDX-42, A5)
 *
 * A standalone card: the product mark, a title, one line and the one primary action back home.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import ProductMark from '../components/ProductMark';

export default function NotFoundPage() {
  return (
    <div className="not-found-page">
      <div className="not-found-page__card">
        <ProductMark className="not-found-page__mark" size={40} />
        <h1 className="not-found-page__title">Page not found</h1>
        <p className="not-found-page__text">That address does not match a page in Cloud Codex.</p>
        <a href="/" className="btn btn-primary">Go home</a>
      </div>
    </div>
  );
}
