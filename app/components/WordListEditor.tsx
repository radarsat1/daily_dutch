'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { useAuth } from './AuthProvider'
import { Database } from '@/lib/schema'

// Helper type to coerce the JSONB column into a string array
type WordListRow = Database['public']['Tables']['word_lists']['Row']
type WordList = Omit<WordListRow, 'words'> & { words: string[] }

export default function WordListEditor() {
  const { user } = useAuth()
  const [lists, setLists] = useState<WordList[]>([])
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newWord, setNewWord] = useState('')
  const [saving, setSaving] = useState(false)

  // Fetch all lists (and their words) at once
  const fetchLists = async () => {
    const { data } = await supabase
      .from('word_lists')
      .select('*')
      .order('name')

    if (data) {
      // Ensure 'words' is treated as an array (handle nulls if any)
      const formatted = data.map(l => ({
        ...l,
        words: Array.isArray(l.words) ? (l.words as string[]) : []
      }))
      setLists(formatted)

      // Select first list by default if none selected
      if (!selectedListId && formatted.length > 0) {
        setSelectedListId(formatted[0].id)
      }
    }
  }

  useEffect(() => {
    fetchLists()
  }, [])

  const createList = async () => {
    if (!user || !newListName.trim()) return

    const { data, error } = await supabase.from('word_lists').insert({
      user_id: user.id,
      name: newListName.trim(),
      words: [] // Initialize with empty JSON array
    }).select().single()

    if (data) {
      const newList = { ...data, words: [] as string[] }
      setLists([...lists, newList])
      setNewListName('')
      setSelectedListId(data.id)
    }
  }

  const updateListWords = async (listId: number, newWords: string[]) => {
    // 1. Optimistic Update (UI updates immediately)
    setLists(prev => prev.map(l =>
      l.id === listId ? { ...l, words: newWords } : l
    ))

    // 2. Persist to DB
    setSaving(true)
    const { error } = await supabase
      .from('word_lists')
      .update({ words: newWords })
      .eq('id', listId)
    setSaving(false)

    // Revert if error (optional, but good practice)
    if (error) {
      console.error('Failed to save words', error)
      fetchLists()
    }
  }

  const addWord = async () => {
    const trimmedWord = newWord.trim()
    if (!user || !trimmedWord || !selectedListId) return

    const activeList = lists.find(l => l.id === selectedListId)
    if (!activeList) return

    // Prevent duplicates (optional, usually good for vocab lists)
    if (activeList.words.includes(trimmedWord)) {
      alert('Word already exists in this list')
      return
    }

    const updatedWords = [trimmedWord, ...activeList.words] // Add to top
    await updateListWords(selectedListId, updatedWords)
    setNewWord('')
  }

  const removeWord = async (indexToRemove: number) => {
    if (!selectedListId) return
    const activeList = lists.find(l => l.id === selectedListId)
    if (!activeList) return

    // Remove by index to handle potential duplicates safely
    const updatedWords = activeList.words.filter((_, i) => i !== indexToRemove)
    await updateListWords(selectedListId, updatedWords)
  }

  const deleteList = async (listId: number) => {
    if(!confirm("Are you sure you want to delete this list?")) return;

    const { error } = await supabase.from('word_lists').delete().eq('id', listId)
    if (!error) {
      const remaining = lists.filter(l => l.id !== listId)
      setLists(remaining)
      if (selectedListId === listId) {
        setSelectedListId(remaining.length > 0 ? remaining[0].id : null)
      }
    }
  }

  const activeList = lists.find(l => l.id === selectedListId)

  return (
    <div className="flex h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Sidebar: List Selector */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-700 uppercase tracking-wider text-xs">Your Lists</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {lists.map(list => (
            <div
              key={list.id}
              className={`group flex justify-between items-center px-3 py-2 rounded-md cursor-pointer text-sm font-medium transition-colors
                ${selectedListId === list.id ? 'bg-white text-blue-700 shadow-sm border border-gray-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
              onClick={() => setSelectedListId(list.id)}
            >
              <span className="truncate">{list.name}</span>
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 rounded-full ml-2">
                {list.words.length}
              </span>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-200 bg-white">
          <form onSubmit={(e) => { e.preventDefault(); createList() }}>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded mb-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              placeholder="New List Name..."
              value={newListName}
              onChange={e => setNewListName(e.target.value)}
            />
            <button className="w-full bg-gray-800 text-white text-xs font-bold py-2 rounded hover:bg-black transition-colors">
              Create List
            </button>
          </form>
        </div>
      </div>

      {/* Main Content: Words Editor */}
      <div className="flex-1 flex flex-col h-full">
        {activeList ? (
          <>
            <div className="p-8 pb-4 border-b border-gray-100 flex justify-between items-center bg-white">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{activeList.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {activeList.words.length} words • {saving ? 'Saving...' : 'Saved'}
                </p>
              </div>
              <button
                onClick={() => deleteList(activeList.id)}
                className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-1 rounded hover:bg-red-50 transition-colors"
              >
                Delete List
              </button>
            </div>

            <div className="p-8 flex-1 overflow-y-auto bg-gray-50/50">
              <div className="max-w-2xl mx-auto">
                <form onSubmit={e => { e.preventDefault(); addWord() }} className="flex gap-3 mb-6">
                  <input
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-lg"
                    placeholder="Type a word..."
                    value={newWord}
                    onChange={e => setNewWord(e.target.value)}
                    autoFocus
                  />
                  <button className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 shadow-sm transition-colors whitespace-nowrap">
                    Add
                  </button>
                </form>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <ul className="divide-y divide-gray-100">
                    {activeList.words.map((word, index) => (
                      <li key={`${index}-${word}`} className="px-6 py-3 hover:bg-gray-50 transition-colors text-gray-700 flex justify-between items-center group">
                        <span className="font-medium">{word}</span>
                        <button
                          type="button"
                          className="text-gray-300 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                          onClick={(e) => { e.preventDefault(); removeWord(index) }}
                          title="Remove word"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </li>
                    ))}
                    {activeList.words.length === 0 && (
                      <li className="px-6 py-10 text-center text-gray-400 italic bg-gray-50/50">
                        No words yet. Type above to add one!
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p>Select a list from the sidebar<br/>or create a new one to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
