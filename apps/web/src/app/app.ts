import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Bare routing host — layout (toolbar/nav) lives in core/layout/Shell. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
