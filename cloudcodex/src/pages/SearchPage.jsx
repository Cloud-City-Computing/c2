import { useState } from 'react'
import SearchBox from '../components/SearchBox'
import SearchResultContainer from '../components/SearchResultContainer'
import '../App.css'

function SearchPage() {
  return (
    <>
        <h1>Cloud Codex</h1>
        <div className="search-page-container">
            <div className="search-section">
                <SearchBox />
            </div>
            <div className="search-section">
                <SearchResultContainer />
            </div>
        </div>
    </>
  )
}

export default SearchPage
