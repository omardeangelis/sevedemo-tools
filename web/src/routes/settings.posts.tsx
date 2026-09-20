import { createFileRoute } from '@tanstack/react-router';
import { PostsCard } from '../components/settings/PostsCard';
import { SettingsData } from '../components/settings/parts';

/** I miei post (J1): elenco dei post e "Sincronizza interazioni". */
export const Route = createFileRoute('/settings/posts')({ component: PostsPage });

function PostsPage() {
  return <SettingsData>{(settings) => <PostsCard readiness={settings.readiness} />}</SettingsData>;
}
