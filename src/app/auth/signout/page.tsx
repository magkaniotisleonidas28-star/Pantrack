import AuthForm from '../auth-form';
import AuthShell from '../auth-shell';
export default function Page() {
  return (
    <AuthShell>
      <AuthForm mode="signout" />
    </AuthShell>
  );
}
