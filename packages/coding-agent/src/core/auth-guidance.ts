export function formatNoModelsAvailableMessage(): string {
	return `No models available. Configure a provider in settings or via an extension, then use /model to select a model.`;
}

export function formatNoModelSelectedMessage(): string {
	return `No model selected.\n\nUse /model to select a model.`;
}

export function formatNoApiKeyFoundMessage(provider: string): string {
	return `No API key found for ${provider}.\n\nSet the provider API key via settings or environment variable, then use /model to select a model.`;
}
