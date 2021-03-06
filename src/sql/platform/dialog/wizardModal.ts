/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/dialogModal';
import { Modal, IModalOptions } from 'sql/base/browser/ui/modal/modal';
import { attachModalDialogStyler } from 'sql/common/theme/styler';
import { Wizard, DialogButton, WizardPage } from 'sql/platform/dialog/dialogTypes';
import { DialogPane } from 'sql/platform/dialog/dialogPane';
import { bootstrapAngular } from 'sql/services/bootstrap/bootstrapService';
import { DialogMessage } from 'sql/workbench/api/common/sqlExtHostTypes';
import { DialogModule } from 'sql/platform/dialog/dialog.module';
import { Button } from 'vs/base/browser/ui/button/button';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { Builder } from 'vs/base/browser/builder';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { attachButtonStyler } from 'vs/platform/theme/common/styler';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Emitter } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

export class WizardModal extends Modal {
	private _dialogPanes = new Map<WizardPage, DialogPane>();
	private _onDone = new Emitter<void>();
	private _onCancel = new Emitter<void>();

	// Wizard HTML elements
	private _body: HTMLElement;

	// Buttons
	private _previousButton: Button;
	private _nextButton: Button;
	private _generateScriptButton: Button;
	private _doneButton: Button;
	private _cancelButton: Button;

	constructor(
		private _wizard: Wizard,
		name: string,
		options: IModalOptions,
		@IPartService partService: IPartService,
		@IWorkbenchThemeService private _themeService: IWorkbenchThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IClipboardService clipboardService: IClipboardService
	) {
		super(_wizard.title, name, partService, telemetryService, clipboardService, contextKeyService, options);
	}

	public layout(): void {

	}

	public render() {
		super.render();
		attachModalDialogStyler(this, this._themeService);

		if (this.backButton) {
			this.backButton.onDidClick(() => this.cancel());
			attachButtonStyler(this.backButton, this._themeService, { buttonBackground: SIDE_BAR_BACKGROUND, buttonHoverBackground: SIDE_BAR_BACKGROUND });
		}

		if (this._wizard.customButtons) {
			this._wizard.customButtons.forEach(button => {
				let buttonElement = this.addDialogButton(button);
				this.updateButtonElement(buttonElement, button);
			});
		}

		this._previousButton = this.addDialogButton(this._wizard.backButton, () => this.showPage(this._wizard.currentPage - 1));
		this._nextButton = this.addDialogButton(this._wizard.nextButton, () => this.showPage(this._wizard.currentPage + 1), true, true);
		this._generateScriptButton = this.addDialogButton(this._wizard.generateScriptButton, () => undefined);
		this._doneButton = this.addDialogButton(this._wizard.doneButton, () => this.done(), false, true);
		this._wizard.doneButton.registerClickEvent(this._onDone.event);
		this._cancelButton = this.addDialogButton(this._wizard.cancelButton, () => this.cancel(), false);
		this._wizard.cancelButton.registerClickEvent(this._onCancel.event);

		let messageChangeHandler = (message: DialogMessage) => {
			if (message && message.text) {
				this.setError(message.text, message.level, message.description);
			} else {
				this.setError('');
			}
		};

		messageChangeHandler(this._wizard.message);
		this._wizard.onMessageChange(message => messageChangeHandler(message));

		this._wizard.pages.forEach((page, index) => {
			page.onValidityChanged(valid => {
				if (index === this._wizard.currentPage) {
					this._nextButton.enabled = this._wizard.nextButton.enabled && page.valid;
					this._doneButton.enabled = this._wizard.doneButton.enabled && page.valid;
				}
			});
		});
	}

	private addDialogButton(button: DialogButton, onSelect: () => void = () => undefined, registerClickEvent: boolean = true, requirePageValid: boolean = false): Button {
		let buttonElement = this.addFooterButton(button.label, onSelect);
		buttonElement.enabled = button.enabled;
		if (registerClickEvent) {
			button.registerClickEvent(buttonElement.onDidClick);
		}
		button.onUpdate(() => {
			this.updateButtonElement(buttonElement, button, requirePageValid);
		});
		attachButtonStyler(buttonElement, this._themeService);
		this.updateButtonElement(buttonElement, button, requirePageValid);
		return buttonElement;
	}

	private updateButtonElement(buttonElement: Button, dialogButton: DialogButton, requirePageValid: boolean = false) {
		buttonElement.label = dialogButton.label;
		buttonElement.enabled = requirePageValid ? dialogButton.enabled && this._wizard.pages[this._wizard.currentPage].valid : dialogButton.enabled;
		dialogButton.hidden ? buttonElement.element.parentElement.classList.add('dialogModal-hidden') : buttonElement.element.parentElement.classList.remove('dialogModal-hidden');
		this.setButtonsForPage(this._wizard.currentPage);
	}

	protected renderBody(container: HTMLElement): void {
		new Builder(container).div({ class: 'dialogModal-body' }, (bodyBuilder) => {
			this._body = bodyBuilder.getHTMLElement();
		});

		this.initializeNavigation(this._body);

		this._wizard.pages.forEach(page => {
			this.registerPage(page);
		});
		this._wizard.onPageAdded(page => {
			this.registerPage(page);
			this.updatePageNumbers();
			this.showPage(this._wizard.currentPage, false);
		});
		this._wizard.onPageRemoved(page => {
			let dialogPane = this._dialogPanes.get(page);
			this._dialogPanes.delete(page);
			this.updatePageNumbers();
			this.showPage(this._wizard.currentPage, false);
			dialogPane.dispose();
		});
		this.updatePageNumbers();
	}

	private updatePageNumbers(): void {
		this._wizard.pages.forEach((page, index) => {
			let dialogPane = this._dialogPanes.get(page);
			dialogPane.pageNumber = index + 1;
		});
	}

	private registerPage(page: WizardPage): void {
		let dialogPane = new DialogPane(page.title, page.content, valid => page.notifyValidityChanged(valid), this._instantiationService, this._wizard.displayPageTitles, page.description);
		dialogPane.createBody(this._body);
		this._dialogPanes.set(page, dialogPane);
		page.onUpdate(() => this.setButtonsForPage(this._wizard.currentPage));
	}

	private async showPage(index: number, validate: boolean = true): Promise<void> {
		let pageToShow = this._wizard.pages[index];
		if (!pageToShow) {
			this.done(validate);
			return;
		}
		if (validate && !await this.validateNavigation(index)) {
			return;
		}
		this._dialogPanes.forEach((dialogPane, page) => {
			if (page === pageToShow) {
				dialogPane.show();
			} else {
				dialogPane.hide();
			}
		});
		this.setButtonsForPage(index);
		this._wizard.setCurrentPage(index);
		let currentPageValid = this._wizard.pages[this._wizard.currentPage].valid;
		this._nextButton.enabled = this._wizard.nextButton.enabled && currentPageValid;
		this._doneButton.enabled = this._wizard.doneButton.enabled && currentPageValid;
	}

	private setButtonsForPage(index: number) {
		if (this._previousButton) {
			if (this._wizard.pages[index - 1]) {
				this._previousButton.element.parentElement.classList.remove('dialogModal-hidden');
				this._previousButton.enabled = this._wizard.pages[index - 1].enabled;
			} else {
				this._previousButton.element.parentElement.classList.add('dialogModal-hidden');
			}
		}

		if (this._nextButton && this._doneButton) {
			if (this._wizard.pages[index + 1]) {
				let isPageValid = this._wizard.pages[index] && this._wizard.pages[index].valid;
				this._nextButton.element.parentElement.classList.remove('dialogModal-hidden');
				this._nextButton.enabled = isPageValid && this._wizard.pages[index + 1].enabled;
				this._doneButton.element.parentElement.classList.add('dialogModal-hidden');
			} else {
				this._nextButton.element.parentElement.classList.add('dialogModal-hidden');
				this._doneButton.element.parentElement.classList.remove('dialogModal-hidden');
			}
		}
	}

	/**
	 * Bootstrap angular for the wizard's left nav bar
	 */
	private initializeNavigation(bodyContainer: HTMLElement) {
		bootstrapAngular(this._instantiationService,
			DialogModule,
			bodyContainer,
			'wizard-navigation',
			{
				wizard: this._wizard,
				navigationHandler: (index: number) => this.showPage(index, index > this._wizard.currentPage)
			},
			undefined,
			() => undefined);
	}

	public open(): void {
		this.showPage(0, false);
		this.show();
	}

	public async done(validate: boolean = true): Promise<void> {
		if (this._doneButton.enabled) {
			if (validate && !await this.validateNavigation(undefined)) {
				return;
			}
			this._onDone.fire();
			this.dispose();
			this.hide();
		}
	}

	public cancel(): void {
		this._onCancel.fire();
		this.dispose();
		this.hide();
	}

	private async validateNavigation(newPage: number): Promise<boolean> {
		let button = newPage === undefined ? this._doneButton : this._nextButton;
		let buttonSpinnerHandler = setTimeout(() => {
			button.enabled = false;
			button.element.innerHTML = '&nbsp';
			button.element.classList.add('validating');
		}, 100);
		let navigationValid = await this._wizard.validateNavigation(newPage);
		clearTimeout(buttonSpinnerHandler);
		button.element.classList.remove('validating');
		this.updateButtonElement(button, newPage === undefined ? this._wizard.doneButton : this._wizard.nextButton, true);
		return navigationValid;
	}

	protected hide(): void {
		super.hide();
	}

	protected show(): void {
		super.show();
	}

	/**
	 * Overridable to change behavior of escape key
	 */
	protected onClose(e: StandardKeyboardEvent) {
		this.cancel();
	}

	/**
	 * Overridable to change behavior of enter key
	 */
	protected onAccept(e: StandardKeyboardEvent) {
		if (this._wizard.currentPage === this._wizard.pages.length - 1) {
			this.done();
		} else {
			if (this._nextButton.enabled) {
				this.showPage(this._wizard.currentPage + 1);
			}
		}
	}

	public dispose(): void {
		super.dispose();
		this._dialogPanes.forEach(dialogPane => dialogPane.dispose());
	}
}