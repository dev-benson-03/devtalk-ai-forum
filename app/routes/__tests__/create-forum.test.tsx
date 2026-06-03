import { render } from '@testing-library/react';
import CreateForum from '../create-forum';
describe('CreateForum route', () => {
  it('renders without crashing', () => {
    render(<CreateForum />);
  });
});
