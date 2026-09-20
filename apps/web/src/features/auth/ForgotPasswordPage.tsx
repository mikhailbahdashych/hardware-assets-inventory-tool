import { Link } from 'react-router';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';

/**
 * There is nothing to submit: this instance sends no email, deliberately. The
 * page exists so the login screen's "Forgot password?" still lands somewhere
 * that says what to actually do.
 */
export function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Ask an admin of this workspace"
      below={<Link to="/login">Back to sign in</Link>}
    >
      <p className={styles.hint}>
        An admin can hand you a reset link, or set a new password for you outright, from the Members
        page. There is no email to wait for — this instance does not send any.
      </p>
    </AuthLayout>
  );
}
