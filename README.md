# Smazy

**Smart about being lazy.** A study desk prototype for university students: drop in a whole course folder once, and study without leaving the lecture slide.

Built for the AWS Hackathon (October 2026). It runs entirely on your own computer.

## In this repository

| Path | What it is |
|---|---|
| [`docs/Smazy_Full_Concept_and_Prototype.pdf`](docs/Smazy_Full_Concept_and_Prototype.pdf) | The full write-up: the problem, the idea, every feature with its status (built, partly built, planned), limitations, risks and next steps. Start here to understand Smazy. |
| [`docs/Smazy_Pitch.pptx`](docs/Smazy_Pitch.pptx) | The 12-slide hackathon pitch deck, with speaker notes for five presenters. |
| [`sample-course/`](sample-course) | A small made-up course ("MNY101 Money Basics") for trying Smazy: three lectures, a syllabus, a homework, project guidelines, a rubric, a reading and a spreadsheet. Drop this folder into Smazy if you have no course folder of your own. |
| `client/`, `server/` | The prototype itself (see **Run it on your computer** below). |

The sample course was written for this repository. Real university course files are not included, because lecture slides and textbooks belong to their authors.

## What it does

1. **Upload a course folder.** Smazy reads every file in the browser.
2. **It sorts the files** into two groups:
   - **Learn**: lecture slides, in order
   - **Course Info**: Syllabus · Homework · Guidelines · Rubric · Readings · Books (references)
3. **It finds the first lecture** (from names like `Lecture 01`, `Week 1`, `L1`, `Wk01`, `01a intro`, `Ch01`, `Mod1`) and opens it. If it isn't sure, it asks.
4. **You study on the slide**, with everything close by:
   - a **Study Partner** (an AI chat with a name and a face, written to talk like a classmate) that knows which slide you're on, with **Quick** or **Deep** answers and voice input
   - conversations saved **per slide**, shown as a **history tree** with follow-ups as branches
   - Preview-style **markup**: highlights, pen, text boxes, and a PDF download with your notes
   - **linked slides**: sticky notes that jump to a slide in another lecture and back
   - a **mini web browser** inside Smazy (`G` then `B`) for quick look-ups
   - keyboard shortcuts for everything (press `?` in the app)

PDF, PowerPoint and Excel files all open inside Smazy.

## Run it on your computer

**You need**

- [Node.js](https://nodejs.org) 18 or newer
- For the AI chat (optional but recommended): [Ollama](https://ollama.com) with a model, e.g. `ollama pull gemma4:e4b`. It is free and runs locally. Without it the chat gives clearly-labelled sample replies; everything else still works.
- For PowerPoint and Word files (optional): [LibreOffice](https://www.libreoffice.org), or Microsoft PowerPoint on a Mac. PDFs and Excel files need nothing extra.

**Steps**

```bash
git clone https://github.com/Theodre21/smazy.git
cd smazy
cp .env.example .env
npm run install:all
npm run dev
```

Then open <http://localhost:5173> in Chrome and drop in a course folder. The [`sample-course`](sample-course) folder in this repository works, or use your own (lecture PDFs or PowerPoints plus a syllabus is enough).

Keep the terminal open while you use it. `Ctrl + C` stops it.

**If something doesn't work**

- *The page won't load:* check the terminal for the address Vite printed; if port 5173 was busy it uses 5174.
- *The chat says "Sample replies":* open the Ollama app and check `ollama list` shows a model.
- *A PowerPoint says it can't be shown:* install LibreOffice, then reopen the file.

## Connecting a chat model

The chat works like Claude or ChatGPT whenever a model is connected, **even in demo mode**. Set `CHAT_PROVIDER` in `smazy/.env`:

| `CHAT_PROVIDER` | Model | Cost |
|---|---|---|
| `ollama` | A free model running on your own computer through [Ollama](https://ollama.com), e.g. `gemma4:e4b` (`ollama pull gemma4:e4b`). Set `OLLAMA_MODEL` to choose one. | Free, private, works offline |
| `claude` | Claude Opus 5.5, with `ANTHROPIC_API_KEY=sk-ant-…` (Claude API) or `AWS_BEARER_TOKEN_BEDROCK=…` (Amazon Bedrock). Declined requests are retried on a fallback model. | Paid per use |
| `auto` (default) | Claude if a key is set, otherwise Ollama if it's running | |

`.env` is re-read on every message, so no restart is needed. The chat header shows which model is answering (e.g. **Free · gemma4** or **Claude**), or **Sample replies** if none is connected.

`MOCK_AI` only controls **file sorting**: `true` uses fast rules (file names, folders, page count); `false` lets the chat model sort, with the rules as a backup.

## Using it

| Key | Action |
|---|---|
| `←` `→` / `Space` | Previous / next slide |
| `/` | Open the chat and start typing; press `/` again (with an empty message box) to close it |
| `Tab` (in the chat) | Switch between this slide's conversation and its history tree |
| `K` then `S` / `H` / `G` / `R` / `D` / `B` | Open the Syllabus / Homework / Guidelines / Rubric / Readings / Books (the first file in that category) |
| `Shift` + `→` / `←` | Next / previous document in the same category (readings, guidelines, lectures…) |
| `G` then a number | Jump to that lecture (e.g. `G` `3`) |
| `G` then `B` | Open the mini web browser |
| `⌘` + `` ` `` (Ctrl + `` ` `` on Windows) | Close the mini web browser and return to your slide |
| `` ` `` (backtick, left of `1`) | Show/hide the course file list in the top-left corner |
| `⌃⌘T` (Ctrl+Alt+T on Windows) | Add a text box on the slide, at the pointer or down the right side |
| `⌃⌘H` | Highlight the selected text (with nothing selected: turn the highlighter on/off) |
| `⌃⌘P` | Pen on/off |
| `⌘Z` | Undo the last markup on this slide |
| `L` then `1` `Space` `12` `Enter` | Link the current lecture slide to Lecture 1, slide 12 (adds a sticky note). Press `L` again, or `Esc`, to cancel before Enter |
| `J` | Jump to the linked slide (asks which one if the slide has several). Press `J` again to come back |
| `B` or `Esc` | Also go back to the slide you came from |
| `F` | Full screen on / off (also the **Full screen** button) |
| `?` | Show the shortcuts guide (also the **Shortcuts** button in the top bar) |
| `Esc` | Back to the normal pointer / close |

**Markup (like macOS Preview):** the toolbar under the slide has Select text, Highlight, Pen, Marker, Text box and Eraser, plus colours, Undo and Clear. Drag a text box by its ⋮⋮ handle; an emptied text box disappears. Markup is saved per slide in your browser. Text boxes default to Times New Roman, 12 pt (measured on the lecture page, so the download has true 12 pt text), with 1.5 line spacing. **⤓ Download** (top bar) saves the open lecture as a PDF with every highlight, drawing and text box included, named `<lecture> (Smazy notes).pdf`.

Keys are ignored while you type in the chat or a text box. In the file list, use the small ▾ next to a file to move it to a different category if Smazy sorted it wrongly. Lecture slides that mention the syllabus, homework, project, or rubric get a button that jumps straight to that file.

**Study Partner:** the chat is presented as a study partner, not a chatbot. It is a small animated character you can make your own: click its face or name in the conversation to open **Make it yours**, then give it a name ("Sam" by default) and choose a character (Blob, Cat, Bear, Bunny, Ghost, Chick), one of seven colours, and an extra (glasses, grad cap, headphones, bow, sprout, coffee). **Surprise me** picks a random combination. The choice is saved in your browser. While you study it sits in the corner of the slide as a companion: it blinks, floats, follows the pointer with its eyes, says hello once, and reminds you when you have already talked about the slide you are on. Press `/` (or click it) and the conversation opens like a messaging app: your messages on the right, its replies as short bubbles on the left, "typing…", "Delivered / Seen", and follow-ups shown as replies to an earlier message. Save, Copy, Listen and Go deeper appear under a reply when you point at it. It talks in a classmate's tone and says honestly that it is an AI if you ask. In full screen the companion moves to the top-right corner and drifts around slowly. It also notices good study habits and says so in a speech bubble: a specific, constructive line when you highlight, draw, write a note, link two slides, download your notes or reach the end of a lecture (for example "Nice link to Lecture 1 · slide 12, and you wrote down why"). It is honest too: after seven highlights on one slide it suggests keeping only the key lines. Routine praise is limited to about once a minute so it does not interrupt. The personality questions that would tailor it to each student are not built yet.

**Chats pinned to slides:** each slide has its own conversation. Ask on slide 12 and it stays with slide 12; move on and the chat is fresh; come back and it's there (the Ask button shows 💬 and a count). The model also decides whether each new question is a new topic or a follow-up to an earlier answer, and follow-ups are shown as branches. Press `Tab` in the chat for **History**: a tree diagram of the questions asked on the slide you're on. Each slide has its own tree. Colour shows the kind of question (the model tags each one: what does this mean, how or why, didn't make sense, example, checking my own idea), numbers show the order asked, and follow-ups branch under their question. **☆ Save** under any answer marks it as important; saved questions get a gold outline and a star in the tree. Click any box to jump back to that conversation.

**Quick or Deep answers:** after you press Enter on a question, choose the answer length with `←` **Quick** (the key point in a few lines, preselected) or `→` **Deep** (a full explanation with an example), then Enter again to send. Esc goes back to editing. Every Quick answer has a **Go deeper →** button that expands it into a full explanation, filed as a follow-up branch.

**Voice:** in the chat, click the microphone and speak; your words appear in the message box (click the mic again to stop, Enter to send). **🔊 Listen** under any answer reads it aloud. Voice typing uses the browser's built-in speech recognition (Chrome, Edge or Safari), needs microphone permission and, in Chrome, an internet connection.

**Linked slides (lectures only):** a link is a yellow sticky note on the slide. Hover it to preview the linked slide, click it (or press `J`) to jump there, drag it to move it, and use × or the eraser to remove it. Right after creating a link, Smazy asks **why** you made it (Enter saves, Esc skips; the ✎ on the note edits it later). That note is hidden: it isn't shown on the slide, in the preview or in the download. It appears next to the Back button after you jump with `J`, and beside the numbers when a slide has several links. Links are saved with the slide's markup and appear in the downloaded PDF as a small "Link: Lecture 1, slide 12" label.

**Mini web browser:** press `G` then `B` (or the **Browser** button) and a browser opens over the slide, with the cursor in the search box. Type a search or a web address and press Enter; links, back, forward and reload work as usual, and the chat can stay open beside it. `⌘` + `` ` `` closes it from anywhere, including inside a web page, and returns you to the same slide (`Esc` is left to the website); `G` `B` reopens it on the page you left. **Web links on your slides are clickable:** real hyperlinks and typed-out addresses (`https://…`, `www.…`) open in this browser when you click them with the normal pointer, and so do links in chat answers. Pages are fetched by Smazy's server and shown in a sandboxed frame, because most websites refuse to be embedded in another page. That means it is for reading and searching: sites that need a login, and heavy web apps (Google, YouTube, online banking), won't work properly. The ↗ button opens the current page in a normal browser tab. Searches use DuckDuckGo.

## Code map

- `server/classify.js`: rule-based sorter, first-lecture finder, link builder
- `server/ai.js`: the chat model (Ollama, Claude API or Claude on Amazon Bedrock)
- `server/convert.js`: PowerPoint and Word to PDF
- `server/index.js`: the API (`/api/organize`, `/api/first-lecture`, `/api/chat`, `/api/place-question`, `/api/convert`, `/api/browse`)
- `client/src/App.tsx`: the upload → sort → find → open flow
- `client/src/Organizing.tsx`: the animated sorting screen
- `client/src/Viewer.tsx`: slide viewer, file list, shortcuts, full screen, linked slides
- `client/src/Markup.tsx` and `Export.ts`: highlights, drawing, text boxes, and the PDF download
- `server/browse.js` and `client/src/Browser.tsx`: the mini web browser
- `client/src/Sheet.tsx`: read-only Excel viewer
- `client/src/Voice.ts`: voice input and read-aloud
- `client/src/Chat.tsx`: chat panel (per-slide conversations, branches, history tree, streaming)
- `client/src/HistoryTree.tsx`: the History tab's tree diagram
- `client/src/threads.ts`: saved conversations, one per slide

Excel and CSV files (`.xlsx`, `.xls`, `.xlsm`, `.ods`, `.csv`) open in a read-only spreadsheet view with sheet tabs and a formula bar (click a cell to see its formula). The chat can read the open sheet.

Prototype limits: PDFs show as slides, PowerPoint converts to slides, Excel shows as a read-only sheet; other files are still sorted, chats live in the browser's localStorage, and there are no accounts or cloud storage.
