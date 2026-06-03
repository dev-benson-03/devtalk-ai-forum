import { render } from '@testing-library/react';
import Signup from '../signup';
describe('Signup route', () => {
  it('renders without crashing', () => {
    render(<Signup />);
  });
});
