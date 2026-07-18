import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { APP_NAME } from '@inventory/shared';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('renders the app name in the toolbar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('mat-toolbar')?.textContent).toContain(APP_NAME);
  });
});
