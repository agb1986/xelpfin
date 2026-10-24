import { nextPageDue } from '../../src/ui/paging';

describe('nextPageDue', () => {
  it('fires once the last visible item passes the middle of the last page', () => {
    expect(nextPageDue(29, 60, 200, 60)).toBe(false);
    expect(nextPageDue(30, 60, 200, 60)).toBe(true);
    expect(nextPageDue(89, 120, 200, 60)).toBe(false);
    expect(nextPageDue(90, 120, 200, 60)).toBe(true);
  });

  it('uses the middle of a short last page', () => {
    expect(nextPageDue(39, 70, 200, 60)).toBe(false);
    expect(nextPageDue(40, 70, 200, 60)).toBe(true);
  });

  it('never fires when everything is loaded or nothing is', () => {
    expect(nextPageDue(59, 60, 60, 60)).toBe(false);
    expect(nextPageDue(0, 0, 100, 60)).toBe(false);
  });
});
