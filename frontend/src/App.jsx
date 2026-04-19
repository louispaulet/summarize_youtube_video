import { useState } from 'react'

const LOCAL_WORKER_URL = 'http://localhost:8787'

function renderInlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }

    return <span key={index}>{part}</span>
  })
}

function SummaryMarkdown({ markdown }) {
  const lines = markdown.split(/\r?\n/)
  const blocks = []
  let paragraphLines = []
  let listItems = []

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return
    }

    blocks.push({
      type: 'paragraph',
      content: paragraphLines.join(' '),
    })
    paragraphLines = []
  }

  function flushList() {
    if (listItems.length === 0) {
      return
    }

    blocks.push({
      type: 'list',
      items: listItems,
    })
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph()
      listItems.push(line.slice(2).trim())
      continue
    }

    flushList()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushList()

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          )
        }

        return <p key={index}>{renderInlineMarkdown(block.content)}</p>
      })}
    </>
  )
}

function normalizeApiError(response, payload) {
  const detail = payload?.detail

  if (detail && typeof detail === 'object') {
    return {
      errorCode:
        typeof detail.error_code === 'string'
          ? detail.error_code
          : 'unexpected_backend_failure',
      message:
        typeof detail.message === 'string'
          ? detail.message
          : 'Something went wrong while summarizing the video.',
      retryable: Boolean(detail.retryable),
      stage:
        typeof detail.stage === 'string' ? detail.stage : 'request_validation',
      status:
        typeof detail.status === 'number' ? detail.status : response.status || null,
    }
  }

  return {
    errorCode: 'unexpected_backend_failure',
    message:
      typeof detail === 'string' && detail
        ? detail
        : 'Something went wrong while summarizing the video.',
    retryable: response.status >= 500,
    stage: 'request_validation',
    status: response.status || null,
  }
}

async function parseJsonSafely(response) {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function stageLabel(stage) {
  switch (stage) {
    case 'request_validation':
      return 'Request validation'
    case 'youtube_track_lookup':
      return 'YouTube track lookup'
    case 'youtube_transcript_fetch':
      return 'YouTube transcript fetch'
    case 'openai_summary':
      return 'OpenAI summary'
    default:
      return 'Unknown stage'
  }
}

function ErrorCard({ error }) {
  if (!error) {
    return null
  }

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
      <p className="font-semibold text-rose-950">{error.message}</p>
      {(error.status || error.errorCode || error.stage) && (
        <p className="mt-2 leading-6 text-rose-800">
          {error.status ? `API status ${error.status}. ` : ''}
          {error.errorCode ? `Code: ${error.errorCode}. ` : ''}
          {error.stage ? `Stage: ${stageLabel(error.stage)}.` : ''}
        </p>
      )}
      {error.retryable ? (
        <p className="mt-2 leading-6 text-rose-800">
          This looks temporary, so retrying in a moment may work.
        </p>
      ) : null}
      {error.apiBaseUrl ? (
        <p className="mt-2 break-all leading-6 text-rose-700">
          API target: {error.apiBaseUrl}
        </p>
      ) : null}
    </div>
  )
}

function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || LOCAL_WORKER_URL

  async function handleSubmit(event) {
    event.preventDefault()

    const trimmedUrl = youtubeUrl.trim()
    if (!trimmedUrl) {
      setError({
        errorCode: 'youtube_url_required',
        message: 'Please enter a YouTube URL to summarize.',
        retryable: false,
        stage: 'request_validation',
        status: 400,
      })
      setSummary('')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSummary('')

    try {
      const response = await fetch(`${apiBaseUrl}/api/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ youtube_url: trimmedUrl }),
      })

      const data = await parseJsonSafely(response)

      if (!response.ok) {
        throw normalizeApiError(response, data)
      }

      setSummary(data?.summary_markdown || '')
    } catch (submitError) {
      if (submitError instanceof TypeError) {
        setError({
          apiBaseUrl,
          errorCode: 'api_unreachable',
          message:
            'The app could not reach the API. Please check that the local Worker or deployed backend is available.',
          retryable: true,
          stage: 'request_validation',
          status: null,
        })
      } else if (submitError && typeof submitError === 'object') {
        setError({
          apiBaseUrl,
          errorCode:
            typeof submitError.errorCode === 'string'
              ? submitError.errorCode
              : 'unexpected_backend_failure',
          message:
            typeof submitError.message === 'string'
              ? submitError.message
              : 'Unable to summarize this video right now.',
          retryable: Boolean(submitError.retryable),
          stage:
            typeof submitError.stage === 'string'
              ? submitError.stage
              : 'request_validation',
          status:
            typeof submitError.status === 'number' ? submitError.status : null,
        })
      } else {
        setError({
          apiBaseUrl,
          errorCode: 'unexpected_backend_failure',
          message: 'Unable to summarize this video right now.',
          retryable: false,
          stage: 'request_validation',
          status: null,
        })
      }
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
                Local Worker: <span className="font-medium text-stone-700">8787</span>.
              </p>
              <ErrorCard error={error} />
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
                <SummaryMarkdown markdown={summary} />
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
