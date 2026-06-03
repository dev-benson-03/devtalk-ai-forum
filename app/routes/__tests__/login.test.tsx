import { render } from '@testing-library/react';
import Login from '../login';
describe('Login route', () => {
  it('renders without crashing', () => {
    render(<Login />);
  });
});
