// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://skillpack.morovid.com',
	integrations: [
		starlight({
			title: 'skillpack',
			description:
				'Install versioned skill packs with scoped skills and generated agents for OpenCode and Codex.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/morovid/skillpack' }],
			editLink: {
				baseUrl: 'https://github.com/morovid/skillpack/edit/main/docs/',
			},
			sidebar: [
				{
					label: 'Pack authors',
					items: [
						{ label: 'Folder structure', slug: 'pack/folder-structure' },
						{ label: 'Manifest (skillpack.pack.json)', slug: 'pack/manifest' },
						{ label: 'Skills', slug: 'pack/skills' },
						{ label: 'Agent definitions', slug: 'pack/agents' },
						{ label: 'Placeholders', slug: 'pack/placeholders' },
					],
				},
				{
					label: 'Users',
					items: [
						{ label: 'Selection config (skillpack.json)', slug: 'user/config' },
						{ label: 'Models file (skillpack.models.json)', slug: 'user/models' },
						{ label: 'Lock file (skillpack-lock.json)', slug: 'user/lock-file' },
						{ label: 'Installed files', slug: 'user/installed-files' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Paths', slug: 'reference/paths' },
						{ label: 'Environment', slug: 'reference/environment' },
						{ label: 'JSON Schemas', slug: 'reference/schemas' },
					],
				},
			],
		}),
	],
});
