import { render } from '@testing-library/react';
import UserDashboard from '../userdashboard';
describe('UserDashboard route', () => {
  it('renders without crashing', () => {
    render(<UserDashboard />);
  });
});
