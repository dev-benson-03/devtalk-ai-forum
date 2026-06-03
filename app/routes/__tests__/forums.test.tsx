import { render } from '@testing-library/react';
import Forums from '../forums';
describe('Forums route', () => {
  it('renders without crashing', () => {
    render(<Forums />);
  });
});
