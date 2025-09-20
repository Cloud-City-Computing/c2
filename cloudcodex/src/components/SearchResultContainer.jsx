import '../App.css'
import SearchResultItem from './SearchResultItem'

function SearchResultContainer() {
  return (
    <>
        <div className="search-results-container">
            <h2>Search Results</h2>
            <SearchResultItem />
            <SearchResultItem />
            <SearchResultItem />
            {/* More SearchResultItem components can be added here */}
        </div>
    </>
  )
}

export default SearchResultContainer
