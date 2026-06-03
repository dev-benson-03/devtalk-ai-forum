import { render } from '@testing-library/react';
import Home from '../home';
describe('Home route', () => {
  it('renders without crashing', () => {
    render(<Home />);
  });
});
