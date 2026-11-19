/** Commands and the editor's right-click menu. */
import { EditorView } from '@codemirror/view';
import { Editor, MarkdownFileInfo, MarkdownView, Menu, WorkspaceLeaf } from 'obsidian';
import { addNote, deleteNote, jumpToNote, noteAtCursor, viewFor } from './editor/actions';
import { editNote, notesField } from './editor/state';
import type MarginaliaPlugin from './main';
import { PANEL_VIEW } from './panel';

/** A command that runs on the editor's view; `when` decides whether it's available. */
function editorCommand(
	plugin: MarginaliaPlugin,
	id: string,
	name: string,
	icon: string,
	run: (view: EditorView) => void,
	when: (view: EditorView) => boolean = () => true,
) {
	plugin.addCommand({
		id,
		name,
		icon,
		editorCheckCallback: (checking: boolean, _editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const view = viewFor(ctx);
			if (!view || !when(view)) return false;
			if (!checking) run(view);
			return true;
		},
	});
}

const hasNotes = (view: EditorView) => view.state.field(notesField).notes.some((n) => n.anchor);

export function registerCommands(plugin: MarginaliaPlugin) {
	editorCommand(plugin, 'add-note', 'Add note', 'message-square-plus', addNote);
	plugin.addCommand({
		id: 'show-notes',
		name: 'Show all notes',
		icon: 'message-square-quote',
		callback: () => void showPanel(plugin),
	});
	editorCommand(
		plugin,
		'edit-note',
		'Edit note at cursor',
		'message-square',
		(view) => {
			const n = noteAtCursor(view);
			if (n) view.dispatch({ effects: editNote.of(n.label) });
		},
		(view) => noteAtCursor(view) !== null,
	);
	editorCommand(
		plugin,
		'delete-note',
		'Delete note at cursor',
		'trash-2',
		(view) => {
			const n = noteAtCursor(view);
			if (n) deleteNote(view, n.label);
		},
		(view) => noteAtCursor(view) !== null,
	);
	editorCommand(plugin, 'next-note', 'Go to next note', 'arrow-down', (view) => jumpToNote(view, 1), hasNotes);
	editorCommand(plugin, 'previous-note', 'Go to previous note', 'arrow-up', (view) => jumpToNote(view, -1), hasNotes);

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, _editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			const view = viewFor(info);
			if (view) editorMenu(menu, view);
		}),
	);
}

function editorMenu(menu: Menu, view: EditorView) {
	const note = noteAtCursor(view);
	if (!note) {
		menu.addItem((i) =>
			i
				.setSection('selection')
				.setTitle('Add note')
				.setIcon('message-square-plus')
				.onClick(() => addNote(view)),
		);
		return;
	}
	menu.addItem((i) =>
		i
			.setSection('selection')
			.setTitle('Edit note')
			.setIcon('message-square')
			.onClick(() => view.dispatch({ effects: editNote.of(note.label) })),
	);
	menu.addItem((i) =>
		i
			.setSection('selection')
			.setTitle('Delete note')
			.setIcon('trash-2')
			.setWarning(true)
			.onClick(() => deleteNote(view, note.label)),
	);
}

/** Open the notes panel in the right sidebar (or bring it forward). */
async function showPanel(plugin: MarginaliaPlugin) {
	const { workspace } = plugin.app;
	let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PANEL_VIEW)[0] ?? null;
	if (!leaf) {
		leaf = workspace.getRightLeaf(false);
		await leaf?.setViewState({ type: PANEL_VIEW, active: true });
	}
	if (leaf) await workspace.revealLeaf(leaf);
}
