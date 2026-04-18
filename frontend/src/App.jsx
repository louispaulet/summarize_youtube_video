import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000'

  async function handleSubmit(event) {
    event.preventDefault()

    const trimmedUrl = youtubeUrl.trim()
    if (!trimmedUrl) {
      setError('Please enter a YouTube URL to summarize.')
      setSummary('')
      return
    }

    setIsSubmitting(true)
    setError('')
    setSummary('')

    try {
      const response = await fetch(`${apiBaseUrl}/api/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ youtube_url: trimmedUrl }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Something went wrong while summarizing the video.')
      }

      setSummary(data.summary_markdown)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to summarize this video right now.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_36%),linear-gradient(160deg,_#fffaf0_0%,_#fff_42%,_#f5f5f4_100%)] text-stone-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 sm:px-10 lg:px-12">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="space-y-6">
            <div className="inline-flex items-center rounded-full border border-amber-300 bg-white/70 px-4 py-1 text-sm font-medium text-amber-900 shadow-sm backdrop-blur">
              YouTube URL in. Executive summary out.
            </div>
            <div className="space-y-4">
              <p className="font-serif text-sm uppercase tracking-[0.35em] text-stone-500">
                Fast transcript recap
              </p>
              <h1 className="max-w-3xl font-serif text-5xl leading-tight text-stone-950 sm:text-6xl">
                Turn any YouTube transcript into a crisp briefing.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-stone-600">
                Paste a video link and the app will fetch its transcript, ask GPT-5
                Nano for a concise recap, and render the result as clean markdown.
              </p>
            </div>
          </div>
          <div className="rounded-[2rem] border border-stone-200 bg-white/85 p-6 shadow-[0_30px_80px_-40px_rgba(120,53,15,0.45)] backdrop-blur">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
                  htmlFor="youtube-url"
                >
                  YouTube URL
                </label>
                <input
                  id="youtube-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-4 text-base text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-500 focus:bg-white focus:ring-4 focus:ring-amber-100"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-stone-950 px-5 py-4 text-base font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                {isSubmitting ? 'Summarizing video...' : 'Summarize video'}
              </button>
              <p className="text-sm leading-6 text-stone-500">
                Local frontend: <span className="font-medium text-stone-700">5173</span>.
                Local backend: <span className="font-medium text-stone-700">8000</span>.
              </p>
              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}
            </form>
          </div>
        </section>
        <section className="mt-10 flex-1">
          <div className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_-45px_rgba(41,37,36,0.55)] backdrop-blur sm:p-8">
            <div className="flex flex-col gap-3 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="mt-2 font-serif text-3xl text-stone-950">
                  Video brief
                </h2>
              </div>
              {!summary ? (
                <p className="max-w-xl text-sm leading-6 text-stone-500">
                  Three takeaways first, then a tight three-paragraph recap.
                </p>
              ) : null}
            </div>
            {summary ? (
              <article className="prose prose-stone prose-lg mt-8 max-w-none prose-headings:font-serif prose-headings:text-stone-950 prose-p:leading-8 prose-strong:text-stone-950 prose-li:marker:text-amber-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
              </article>
            ) : (
              <div className="mt-8 rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
                <p className="font-serif text-2xl text-stone-800">
                  Your brief will appear here.
                </p>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-stone-500">
                  Paste a YouTube link above to generate a concise recap.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
